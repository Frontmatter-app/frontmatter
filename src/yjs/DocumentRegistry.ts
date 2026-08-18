import * as Y from "yjs";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../filesystem/tauriCommands";
import { diff_match_patch } from "diff-match-patch";
import { create } from "zustand";
import { getSettings } from "../settings/settingsStore";
import { usePlanStore } from "../billing/PlanProvider";
import { getCurrentUser } from "../auth/session";
import { useSyncStatusStore } from "../cloud/syncStatusStore";
import { Awareness } from "y-protocols/awareness";
import { RoomProvider } from "../collab/RoomProvider";
import { buildClaim, type RoomCoordinate } from "../collab/roomClaim";
import { useRoomStore } from "../collab/roomStore";
import { getCollabSocketUrl } from "../api/serverUrl";
import { requestGrant, type RoomGrant } from "../collab/roomGrant";
import { ROOM_SEED_ORIGIN, deterministicSeed, seedIfEmpty } from "./roomSeed";
import { reconcileIntoDocument } from "./gitReconcile";
import { generateDraftFromMarkdown } from "./draftUtils";
import { saveToLocalDb, syncDraftNodesToDb, syncToCloud, loadDocData, applyDocData, buildDocSavePayload } from "./documentSync";
import { sweepLocalAssets } from "../images/assetGc";
import { GitBackedDocument, type CommitOutcome, type GitDocumentTarget } from "./gitBackedDocument";
import type { ForgePort } from "../forge/ports";
import { automaticCommitMessage, shouldCommit } from "../forge/commitPolicy";

interface DirtyDocsStore {
  dirtyDocs: Set<string>;
  setDirty: (documentId: string, isDirty: boolean) => void;
}

export const useDirtyDocsStore = create<DirtyDocsStore>((set) => ({
  dirtyDocs: new Set<string>(),
  setDirty: (documentId, isDirty) =>
    set((state) => {
      const next = new Set(state.dirtyDocs);
      if (isDirty) next.add(documentId);
      else next.delete(documentId);
      return { dirtyDocs: next };
    }),
}));

const dmp = new diff_match_patch();

/** Whether a binding still points at the same file on the same branch. */
function sameTarget(a: GitDocumentTarget, b: GitDocumentTarget): boolean {
  return a.repo === b.repo && a.branch === b.branch && a.path === b.path;
}

/** How often the autosave loop runs, and so how often anything is written. */
const AUTOSAVE_INTERVAL_MS = 5000;

/**
 * Floor between automatic snapshots. History is capped per document
 * (`MAX_SNAPSHOTS` in `commands/snapshots.rs`), so cadence buys depth: at one
 * per autosave the cap held minutes, at one per two minutes it holds hours.
 */
const AUTO_SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000;

export class DocumentRegistry {
  private acquiring = new Map<string, Promise<Y.Doc>>();
  private docs = new Map<
    string,
    { doc: Y.Doc; refs: number; interval?: any; isCloud: boolean; awareness: Awareness }
  >();
  private unlistenFileChanged: (() => void) | null = null;
  private providers = new Map<string, RoomProvider>();
  private lastSavedContent = new Map<string, string>();
  /** Releases that arrived while an acquire was still in flight. */
  private pendingReleases = new Map<string, number>();
  /** Documents bound to a file in a repository, by document id. */
  private gitDocs = new Map<string, GitBackedDocument>();
  /** Attachments in flight, so a re-render cannot start a second one. */
  private attaching = new Map<string, Promise<GitBackedDocument | null>>();
  /** When each document last changed, for the idle commit policy. */
  private lastChangeAt = new Map<string, number>();
  /**
   * The commit in flight for a document, if any.
   *
   * Held as a promise rather than a flag because two callers need different
   * things from it: the autosave tick needs to know one is running so it does
   * not start a second, and teardown needs to wait for it before destroying the
   * document out from under it.
   */
  private committing = new Map<string, Promise<unknown>>();

  constructor() {
    this.initWatcher();
  }

  /**
   * Whether a document's content is owned by the sync server.
   *
   * This is a property of the *document*, not of the workspace you happen to be
   * in. A file on disk is a local document even when a team workspace is open:
   * a team workspace still lists every markdown file in the folder you opened,
   * and those files have no `cloud_documents` record for a server to sync from.
   *
   * Getting this wrong destroys files. Cloud documents deliberately skip local
   * seeding — the server supplies their content — so treating a local file as a
   * cloud document opens it blank, and the next autosave writes that blank back
   * over the file on disk.
   */
  /**
   * The awareness instance for a document, for as long as it is open.
   *
   * Owned here rather than by the provider, because the editor binds its cursor
   * extension to whatever instance exists at mount and never looks again.
   * Creating one inside the provider meant an editor mounted before the room
   * connected — which is every editor, since connecting needs a network round
   * trip — stayed bound to a private instance with no peers in it. Cursors
   * rendered for nobody, and the cause looked like a transport failure rather
   * than the object-lifetime mistake it was.
   */
  awarenessFor(documentId: string): Awareness | null {
    return this.docs.get(documentId)?.awareness ?? null;
  }

  private async initWatcher() {
    try {
      this.unlistenFileChanged = await listen("file-changed", (event: any) => {
        const { document_id, content } = event.payload;
        const entry = this.docs.get(document_id);
        if (!entry) return;

        const lastSaved = this.lastSavedContent.get(document_id);
        if (lastSaved === content) return;

        const ytext = entry.doc.getText("markdown");
        const currentText = ytext.toString();
        if (currentText === content) return;

        const diffs = dmp.diff_main(currentText, content);
        dmp.diff_cleanupSemantic(diffs);
        entry.doc.transact(() => {
          let cursor = 0;
          for (const [op, text] of diffs) {
            if (op === 1) { ytext.insert(cursor, text); cursor += text.length; }
            else if (op === -1) { ytext.delete(cursor, text.length); }
            else if (op === 0) { cursor += text.length; }
          }
        }, "external-watcher");
      });
    } catch (e) {
      console.error("Failed to initialize file watcher listener", e);
    }
  }

  async acquire(documentId: string): Promise<Y.Doc> {
    const existing = this.docs.get(documentId);
    if (existing) { existing.refs++; return existing.doc; }

    // A release that arrives before the acquire resolves is recorded here.
    // `docs.set` happens at the end of the async body, so such a release used to
    // find no entry, no-op, and leave the document, its autosave interval, and
    // its provider alive for the rest of the session.
    const pendingReleases = this.pendingReleases.get(documentId) ?? 0;
    this.pendingReleases.set(documentId, pendingReleases);

    const alreadyAcquiring = this.acquiring.get(documentId);
    if (alreadyAcquiring) {
      const doc = await alreadyAcquiring;
      const entry = this.docs.get(documentId);
      if (entry) entry.refs++;
      return doc;
    }

    const acquirePromise = (async () => {
      const doc = new Y.Doc();
      // A document is "cloud" only if the sync server owns its content. Nothing
      // does today — every document is a file on disk, and a room is a live
      // session over that file rather than a different home for it. The flag
      // stays because `applyDocData` uses it to decide whether to seed from the
      // local record, and seeding a server-owned document from a blank local
      // one is how files used to get emptied.
      const isCloud = false;
      try {
        const { data, parsed } = await loadDocData(documentId);
        applyDocData(doc, data, parsed, { isCloud });

        const ytext = doc.getText("markdown");
        const draftText = doc.getText("draft");

        // Local documents only. The outline is deterministic content with
        // non-deterministic authorship, so two peers generating it each
        // inserted their own copy into the shared draft. Cloud documents get
        // theirs from the sync server's one-time bootstrap.
        if (!isCloud && !parsed.draft && !parsed.yjs_state && parsed.markdown) {
          const generatedDraft = generateDraftFromMarkdown(parsed.markdown, false);
          if (generatedDraft) draftText.insert(0, generatedDraft);
        }

        const handleUpdate = () => {
          this.lastChangeAt.set(documentId, Date.now());
          useDirtyDocsStore.getState().setDirty(documentId, true);
        };
        ytext.observe(handleUpdate);
        draftText.observe(handleUpdate);

        // Text is not the only thing worth saving. Replies, resolutions,
        // suggestion records and hidden lint rules all live in these maps, and
        // the autosave interval below returns early unless the document is
        // dirty — so without these, resolving a note and closing the document
        // threw the resolution away unless you happened to type afterwards.
        doc.getMap("annotations").observeDeep(handleUpdate);
        doc.getMap("suggestions").observeDeep(handleUpdate);
        doc.getMap("meta").observeDeep(handleUpdate);
      } catch (e) {
        console.error("Failed to acquire document:", e);
      }

      let lastSnapshotText = doc.getText("markdown").toString();
      let lastSnapshotAt = 0;
      const interval = setInterval(async () => {
        const text = doc.getText("markdown").toString();

        // Ahead of the dirty check below, deliberately. An idle document is by
        // definition one that has stopped changing, so an earlier tick has
        // already saved it and cleared the flag — evaluating the idle policy
        // after the early return would mean it never fired at all.
        await this.maybeCommitAutomatically(documentId, 'idle');

        const isDirty = useDirtyDocsStore.getState().dirtyDocs.has(documentId);
        if (!isDirty) return;

        const { autoSave, autoSync } = getSettings();
        if (autoSave) {
          this.lastSavedContent.set(documentId, text);
          try {
            await saveToLocalDb(doc, documentId);
            await syncDraftNodesToDb(doc, documentId);
          } catch (e) { console.error("Autosave failed:", e); }
        }
        // Only for documents with no CRDT channel. Pushing the whole `content`
        // blob alongside the sync server would be two writers with no version
        // check racing the same field — the blob would clobber merged text.
        if (autoSync && !this.providers.has(documentId)) {
          await syncToCloud(doc, documentId);
        }
        useDirtyDocsStore.getState().setDirty(documentId, false);

        // Autosave runs on this interval, but history does not need to. At one
        // snapshot per save the fifty-entry cap held only a few minutes of
        // work, so the oldest — and most useful — versions were always the
        // first to go. The floor buys hours of depth from the same cap.
        const now = Date.now();
        const changed = text !== lastSnapshotText && text.trim().length > 0;
        if (changed && now - lastSnapshotAt >= AUTO_SNAPSHOT_INTERVAL_MS) {
          lastSnapshotText = text;
          lastSnapshotAt = now;
          const wordCount = text.trim().split(/\s+/).length;
          try {
            await invoke("save_snapshot", {
              documentId,
              snapshot: Array.from(Y.encodeStateAsUpdate(doc)),
              // The IPC contract is camelCase. Sent as `word_count` this was
              // silently dropped, and every version showed a blank word count.
              wordCount,
            });
          } catch (e) {
            // No workspace open, most often. Unhandled, this rejected the
            // interval callback with nothing to catch it.
            console.error("Auto-snapshot failed:", e);
          }
        }
      }, AUTOSAVE_INTERVAL_MS);

      // Settle any releases that landed while this was in flight.
      const deferred = this.pendingReleases.get(documentId) ?? 0;
      this.pendingReleases.delete(documentId);
      const refs = 1 - deferred;

      // Created here, with the document, and living exactly as long as it does.
      // The editor binds to this instance at mount; a room attaching later
      // joins it rather than replacing it.
      const awareness = new Awareness(doc);

      this.docs.set(documentId, { doc, refs, interval, isCloud, awareness });
      if (refs <= 0) {
        this.teardown(documentId);
        return doc;
      }

      return doc;
    })();

    this.acquiring.set(documentId, acquirePromise);
    try { return await acquirePromise; }
    finally { this.acquiring.delete(documentId); }
  }

  private teardown(documentId: string): void {
    const entry = this.docs.get(documentId);
    if (!entry) return;
    clearInterval(entry.interval);

    // Everything is unregistered up front. The last commit below is asynchronous
    // and the document can be reopened while it runs; leaving these in place
    // would hand the reopened document the entry that is on its way out.
    this.docs.delete(documentId);
    const lastChangeAt = this.lastChangeAt.get(documentId) ?? 0;
    this.lastChangeAt.delete(documentId);
    const git = this.gitDocs.get(documentId);
    this.gitDocs.delete(documentId);

    const provider = this.providers.get(documentId);
    // Read before the socket closes, since this is who was in the room.
    const coAuthors = git ? this.coAuthorsFor(documentId) : [];
    const peersRemaining = provider?.peers().length ?? 0;
    if (provider) { provider.destroy(); this.providers.delete(documentId); }
    useRoomStore.getState().leave(documentId);

    // The awareness outlives the provider but not the document: the editor
    // bound to it is going away with them.
    const dispose = () => {
      entry.awareness.destroy();
      entry.doc.destroy();
    };

    if (!git) { dispose(); return; }

    // A commit is already writing this document's text — most likely one the
    // user asked for as they closed it. Flushing again behind it would commit
    // the same content twice, but it still has to finish before the document it
    // is reading can be destroyed.
    const inFlight = this.committing.get(documentId);
    if (inFlight) {
      void inFlight.finally(dispose);
      return;
    }

    // Destroying the document is deferred until the commit has finished: it
    // reads the text, and on a branch that moved it merges the remote revision
    // back in before writing. Neither survives a destroyed Y.Doc.
    void this.commitIfPolicyAllows({
      git,
      doc: entry.doc,
      reason: 'empty',
      // We are the one leaving, so the room keeps only the others.
      peersRemaining,
      idleMs: Date.now() - lastChangeAt,
      coAuthors,
    }).finally(dispose);
  }

  release(documentId: string): void {
    const existing = this.docs.get(documentId);
    if (!existing) {
      // Still acquiring: record it so the acquire can settle the balance.
      if (this.acquiring.has(documentId)) {
        this.pendingReleases.set(documentId, (this.pendingReleases.get(documentId) ?? 0) + 1);
      }
      return;
    }
    existing.refs--;
    if (existing.refs > 0) return;
    this.teardown(documentId);
  }

  getProvider(documentId: string): RoomProvider | undefined {
    return this.providers.get(documentId);
  }

  /**
   * Binds an open document to a file in a repository.
   *
   * Uses `attach` rather than `load`: the document is already open, and its
   * text is the working copy read from disk. `load` would merge the branch into
   * text that already contains it. What this establishes is the base revision —
   * the commit the next write is authored against, and so the thing that turns
   * it into a conflict-detecting write rather than an overwrite of whatever
   * anybody else has pushed.
   *
   * Re-binding the same document to a different target replaces the binding,
   * which is what checking out another branch amounts to.
   */
  async attachGitDocument(
    documentId: string,
    forge: ForgePort,
    target: GitDocumentTarget,
  ): Promise<GitBackedDocument | null> {
    const existing = this.gitDocs.get(documentId);
    if (existing && sameTarget(existing.target, target)) return existing;

    const inFlight = this.attaching.get(documentId);
    if (inFlight) {
      const attached = await inFlight;
      if (attached && sameTarget(attached.target, target)) return attached;
    }

    const entry = this.docs.get(documentId);
    if (!entry) return null;

    const attach = (async () => {
      const document = new GitBackedDocument(forge, target, entry.doc.getText("markdown"));
      try {
        await document.attach();
      } catch (e) {
        // Offline, an expired token, a repository the account cannot see. The
        // panel reports it; binding simply does not happen, and the document
        // stays exactly as usable as it was before.
        console.error('[registry] Could not bind the document to its repository:', e);
        return null;
      }
      // The document may have been closed while the branch was being read.
      // Storing the binding now would leak it past teardown.
      if (!this.docs.has(documentId)) return null;
      this.gitDocs.set(documentId, document);
      return document;
    })();

    this.attaching.set(documentId, attach);
    try { return await attach; }
    finally { this.attaching.delete(documentId); }
  }

  getGitDocument(documentId: string): GitBackedDocument | undefined {
    return this.gitDocs.get(documentId);
  }

  /**
   * Joins the live room for a bound document.
   *
   * Rooms are addressed by where the file lives — repository, branch, path —
   * so everyone who opens it arrives in the same one. That is the whole reason
   * this hangs off the git binding rather than off the document id: an id is
   * generated locally and means nothing on anybody else's machine, which is
   * why two people opening one file could never previously have met.
   *
   * Failure is quiet and total: no server, not signed in, no claim to make. In
   * every case the document stays exactly as usable as it was, just alone.
   */
  async attachRoom(
    documentId: string,
    forge: ForgePort,
    coordinate: RoomCoordinate,
  ): Promise<RoomProvider | null> {
    if (this.providers.has(documentId)) return this.providers.get(documentId)!;
    if (!getCurrentUser()) return null;
    if (!getCollabSocketUrl()) return null;

    const entry = this.docs.get(documentId);
    if (!entry) return null;

    const claim = await buildClaim(forge, coordinate);
    // No claim means the forge could not confirm this account may touch the
    // repository. Joining anyway would be asserting access on a guess.
    if (!claim) return null;

    try {
      const grant = await requestGrant(coordinate, claim);

      // Closed while the grant was in flight, or another attach won the race.
      if (!this.docs.has(documentId) || this.providers.has(documentId)) return null;

      // Before the socket opens, never after: the moment it connects, whatever
      // this document holds is pushed to the room as this machine's own work.
      this.adoptSharedIdentity(documentId);

      const provider = new RoomProvider(grant, entry.doc, entry.awareness, {
        renew: async () => {
          const fresh = await buildClaim(forge, coordinate, { refresh: true });
          return fresh ? requestGrant(coordinate, fresh) : null;
        },
        // Access can be lowered while the document is open, once verification
        // catches up with the claim it was joined on. The editor has to hear
        // about it, or somebody carries on typing into a document whose changes
        // the server is already dropping.
        onAccessChange: (access) => {
          if (access === 'none') {
            useRoomStore.getState().leave(documentId);
            return;
          }
          useRoomStore.getState().setAccess(documentId, access);
        },
      });

      this.providers.set(documentId, provider);
      useRoomStore.getState().join(documentId, {
        roomId: grant.roomId,
        access: grant.access,
        verification: grant.verification,
      });
      return provider;
    } catch (e) {
      console.error('[registry] Could not join the room for this document:', e);
      return null;
    }
  }

  /**
   * Rewrites a document's text under an identity every machine computes alike.
   *
   * The problem this solves is easy to miss and impossible to undo. A CRDT does
   * not recognise text by reading it: every character is an item labelled with
   * *who* authored it. Two people who each opened the same file locally hold
   * the same words under two different sets of labels, so when both join a
   * room, the room keeps both — the document arrives doubled, and no
   * merge afterwards can tell which half to drop.
   *
   * So before connecting, the shared text is re-authored from the committed
   * revision using a fixed author id, which every machine produces byte for
   * byte identically. Whatever this machine had beyond the commit is then
   * layered back on as an ordinary edit, by its real author, as a minimal diff.
   *
   * The cost, stated plainly: comment and suggestion anchors are stored as
   * positions relative to the *old* items, and those items no longer exist, so
   * anchors placed before a document first joined a room do not survive the
   * transition. That is the price of the text acquiring an identity other
   * people can share, and it is paid once per document.
   */
  private adoptSharedIdentity(documentId: string): void {
    const entry = this.docs.get(documentId);
    const git = this.gitDocs.get(documentId);
    if (!entry || !git) return;

    const text = entry.doc.getText('markdown');
    const working = text.toString();
    const committed = git.base.text;

    // Already nothing but the deterministic seed — a document opened fresh in
    // this session, with no local history to replace.
    if (working === committed && seedIfEmpty(entry.doc, committed)) return;

    entry.doc.transact(() => {
      if (text.length > 0) text.delete(0, text.length);
      Y.applyUpdate(entry.doc, deterministicSeed(committed), ROOM_SEED_ORIGIN);
    }, ROOM_SEED_ORIGIN);

    if (working !== committed) {
      // Applied as a diff rather than a rewrite, so this machine's unpushed
      // work arrives in the room as the handful of edits it actually is.
      reconcileIntoDocument(text, committed, working);
    }
  }

  /**
   * Commits a bound document because somebody asked.
   *
   * Goes through the registry rather than straight to the `GitBackedDocument`
   * so the commit carries its co-authors, and so an explicit commit and an
   * automatic one are the same write with the same conflict handling — only the
   * message and the reason for it differ.
   */
  async commitDocument(documentId: string, message: string): Promise<CommitOutcome> {
    const git = this.gitDocs.get(documentId);
    if (!git) {
      return { status: 'failed', error: new Error('This document is not bound to a repository.') };
    }
    const work = git.commit({ message, coAuthors: this.coAuthorsFor(documentId) });
    this.committing.set(documentId, work.catch(() => undefined));
    try {
      return await work;
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e : new Error(String(e)) };
    } finally {
      this.committing.delete(documentId);
    }
  }

  /**
   * Everyone else in the document, as commit trailers.
   *
   * A collaborative session produces one commit containing several people's
   * writing, and attributing it solely to whoever pressed the button would be a
   * quiet lie about who wrote what. Peers who have hidden their address are
   * dropped rather than given a fabricated one.
   */
  private coAuthorsFor(documentId: string): Array<{ name: string; email: string }> {
    const provider = this.providers.get(documentId);
    if (!provider) return [];
    return provider
      .peers()
      .filter((peer) => !!peer.email)
      .map((peer) => ({ name: peer.displayName || peer.email!, email: peer.email! }));
  }

  /**
   * Commits a bound document if the policy asks for it.
   *
   * `peersRemaining` is the number of people who will still be in the document
   * *after* this moment: the other peers plus ourselves while it is open, and
   * the other peers alone when it is closing. That distinction is the whole
   * difference between the two triggers — `on-empty` must fire as the last
   * person leaves, and must not fire on the autosave tick of someone who is
   * sitting there writing.
   */
  private async maybeCommitAutomatically(documentId: string, reason: 'idle' | 'empty'): Promise<void> {
    const git = this.gitDocs.get(documentId);
    const entry = this.docs.get(documentId);
    if (!git || !entry) return;

    // The autosave tick does not wait for the previous one. Two commits racing
    // the same branch would make the second conflict against a base the first
    // is in the middle of moving — recoverable, but it fills the history with
    // merges nobody asked for.
    if (this.committing.has(documentId)) return;

    const work = this.runAutomaticCommit(documentId, git, entry.doc, reason);
    this.committing.set(documentId, work.catch(() => undefined));
    try {
      await work;
    } finally {
      this.committing.delete(documentId);
    }
  }

  private async runAutomaticCommit(
    documentId: string,
    git: GitBackedDocument,
    doc: Y.Doc,
    reason: 'idle' | 'empty',
  ): Promise<void> {
    await this.commitIfPolicyAllows({
      git,
      doc,
      reason,
      // Still open, so the room keeps whoever is sitting here writing.
      peersRemaining: (this.providers.get(documentId)?.peers().length ?? 0) + 1,
      idleMs: Date.now() - (this.lastChangeAt.get(documentId) ?? 0),
      coAuthors: this.coAuthorsFor(documentId),
    });
  }

  /**
   * Takes everything it needs as arguments rather than looking it up.
   *
   * Teardown removes a document from the registry before its final commit runs,
   * so by then there is nothing left to look up — and that ordering is what
   * stops a document reopened mid-commit from being handed the entry that is on
   * its way out.
   */
  private async commitIfPolicyAllows(args: {
    git: GitBackedDocument;
    doc: Y.Doc;
    reason: 'idle' | 'empty';
    peersRemaining: number;
    idleMs: number;
    coAuthors: Array<{ name: string; email: string }>;
  }): Promise<void> {
    const { git, doc, reason, peersRemaining, idleMs, coAuthors } = args;

    const allowed = shouldCommit(getSettings().versionControl?.commitPolicy ?? 'explicit', {
      requestedByUser: false,
      peersRemaining,
      idleMs,
      dirty: doc.getText("markdown").toString() !== git.base.text,
    });
    if (!allowed) return;

    try {
      const outcome = await git.commit({
        message: automaticCommitMessage(git.target.path, reason),
        coAuthors,
      });
      if (outcome.status === 'failed') {
        console.error('[registry] Automatic commit failed:', outcome.error);
      }
    } catch (e) {
      console.error('[registry] Automatic commit failed:', e);
    }
  }

  async saveDocument(documentId: string): Promise<void> {
    const entry = this.docs.get(documentId);
    if (!entry) return;

    const { doc } = entry;
    const text = doc.getText("markdown").toString();
    try {
      this.lastSavedContent.set(documentId, text);
      await saveToLocalDb(doc, documentId);
      await syncDraftNodesToDb(doc, documentId);
      await syncToCloud(doc, documentId);
      useDirtyDocsStore.getState().setDirty(documentId, false);
    } catch (e) {
      console.error("Failed to manually save document:", e);
    }

    // On explicit save only, never on autosave: a sweep right after every
    // keystroke pause would keep racing edits in progress. Unreferenced files
    // are moved to `.assets/trash`, and only once they are a day old.
    const filePath = doc.getMap("meta").get("file_path") as string | undefined;
    if (filePath) {
      const docDir = filePath.substring(0, filePath.lastIndexOf("/"));
      sweepLocalAssets(doc, docDir)
        .then(({ trashed }) => {
          if (trashed.length > 0) {
            console.info(`[assets] Moved ${trashed.length} unreferenced image(s) to .assets/trash`);
          }
        })
        .catch((e) => console.warn("[assets] Sweep failed:", e));
    }
  }

  getActive(): string[] {
    return Array.from(this.docs.keys());
  }
}

export const registry = new DocumentRegistry();

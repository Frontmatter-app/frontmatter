import { useState, useEffect, useMemo } from 'react';
import type { DocumentMeta, CloudFolderMeta } from '../types';
import type { TeamGroupsMap } from '../auth/teamPermissions';
import { subscribeToCloudDocuments, subscribeToCloudFolders } from '../cloud/cloudDocuments';
import { useSyncStatusStore } from '../cloud/syncStatusStore';

interface UseWorkspaceDocumentsOptions {
  user: { id: string } | null;
  isAuthor: boolean;
  teamId: string | null;
  isTeamOwner: boolean;
  teamDoc: { groups?: TeamGroupsMap } | null;
  activeContext: { type: 'personal' | 'team' };
}

export function useWorkspaceDocuments(opts: UseWorkspaceDocumentsOptions) {
  const [localDocuments, setLocalDocuments] = useState<DocumentMeta[]>([]);
  const [cloudDocuments, setCloudDocuments] = useState<DocumentMeta[]>([]);
  const [cloudFolders, setCloudFolders] = useState<CloudFolderMeta[]>([]);

  const documents = useMemo(() => {
    const map = new Map<string, DocumentMeta>();
    localDocuments.forEach((doc) => map.set(doc.id, doc));
    cloudDocuments.forEach((cloudDoc) => {
      const existing = map.get(cloudDoc.id);
      if (existing) {
        map.set(cloudDoc.id, {
          ...existing,
          cloud_synced: existing.cloud_synced || existing.cloud_id === cloudDoc.id,
          cloud_path: existing.cloud_path || cloudDoc.cloud_path,
        });
      } else {
        map.set(cloudDoc.id, { ...cloudDoc, is_cloud: true });
      }
    });
    return Array.from(map.values());
  }, [localDocuments, cloudDocuments]);

  useEffect(() => {
    if (opts.user && opts.isAuthor) {
      const myGroupIds = opts.activeContext.type === 'team'
        ? Object.entries((opts.teamDoc?.groups ?? {}) as TeamGroupsMap)
            .filter(([, group]) => group.members.includes(opts.user!.id))
            .map(([groupId]) => groupId)
        : [];

      const unsub = subscribeToCloudDocuments(
        opts.user.id,
        opts.teamId,
        { isTeamOwner: opts.isTeamOwner, myGroupIds },
        (cloudDocs) => {
          setCloudDocuments(cloudDocs);
          useSyncStatusStore.getState().setCloudDocumentIds(cloudDocs.map(d => d.id));
        },
      );
      return () => {
        unsub();
        useSyncStatusStore.getState().setCloudDocumentIds([]);
      };
    } else if (!opts.user) {
      setCloudDocuments([]);
      setCloudFolders([]);
      useSyncStatusStore.getState().setCloudDocumentIds([]);
    }
  }, [opts.user, opts.isAuthor, opts.teamId, opts.isTeamOwner, opts.teamDoc, opts.activeContext]);

  useEffect(() => {
    if (!opts.user || !opts.isAuthor) {
      setCloudFolders([]);
      return;
    }
    const unsub = subscribeToCloudFolders(opts.user.id, opts.teamId, setCloudFolders);
    return () => unsub();
  }, [opts.user, opts.isAuthor, opts.teamId]);

  return {
    localDocuments, setLocalDocuments,
    cloudDocuments, setCloudDocuments,
    cloudFolders, setCloudFolders,
    documents,
  };
}

import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { X, Copy, Check, Mail, UserMinus, Shield, ShieldCheck } from 'lucide-react';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove, collection, query, where, getDocs, setDoc, addDoc } from 'firebase/firestore';
import { db } from '../auth/AuthProvider';
import { showConfirmDialog, showAlertDialog } from '../lib/tauriDialog';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TeamMember {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
}

export function ShareModal({ isOpen, onClose }: ShareModalProps) {
  const { currentDocumentId } = useWorkspace();
  const { user } = useAuth();
  const { teamId, isTeamOwner } = usePlan();
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [inviteError, setInviteError] = useState('');

  const collabLink = `marktype://collab/${currentDocumentId}`;

  // Fetch team members list
  const fetchTeamMembers = async () => {
    if (!teamId) return;
    setLoadingMembers(true);
    try {
      const teamSnap = await getDoc(doc(db, 'teams', teamId));
      if (teamSnap.exists()) {
        const teamData = teamSnap.data();
        const memberIds: string[] = [teamData.ownerId, ...(teamData.members || [])];
        
        const membersList: TeamMember[] = [];
        for (const uid of memberIds) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) {
            const data = userSnap.data();
            membersList.push({
              uid,
              email: data.email || 'No email',
              displayName: data.displayName || 'Unknown User',
              role: uid === teamData.ownerId ? 'owner' : 'member'
            });
          }
        }
        setTeamMembers(membersList);
      }
    } catch (e) {
      console.error('Failed to fetch team members:', e);
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => {
    if (isOpen && teamId) {
      fetchTeamMembers();
    }
  }, [isOpen, teamId]);

  // Listen for invite requests dispatched from Settings → Plan & Billing
  useEffect(() => {
    const handler = async (e: Event) => {
      const email = (e as CustomEvent<{ email: string }>).detail?.email;
      if (!email || !teamId || !isTeamOwner) return;
      setInviteEmail(email);
      // Simulate a submit — re-use the existing invite logic
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      setInviteEmail(email);
      // Trigger the invite directly
      try {
        const teamSnap = await (await import('firebase/firestore')
          .then(m => m.getDoc(m.doc(db, 'teams', teamId))));
        if (teamSnap.exists()) {
          const teamData = teamSnap.data();
          const currentSize = (teamData.members || []).length + 1;
          if (currentSize >= 10) throw new Error('Team limit reached. Up to 10 seats allowed.');
        }
        const { collection: col, query: q, where, getDocs: gd, updateDoc, arrayUnion, doc: docRef, addDoc } = await import('firebase/firestore');
        const snap = await gd(q(col(db, 'users'), where('email', '==', email.toLowerCase())));
        if (!snap.empty) {
          const targetDoc = snap.docs[0];
          const teamRef = docRef(db, 'teams', teamId);
          await updateDoc(teamRef, { members: arrayUnion(targetDoc.id) });
          await updateDoc(targetDoc.ref, { teamId });
        } else {
          await addDoc(col(db, 'invites'), { email: email.toLowerCase(), teamId, invitedBy: user?.id, createdAt: new Date().toISOString() });
        }
        fetchTeamMembers();
      } catch (err: any) {
        console.error('billing-invite-member failed:', err.message);
      }
    };
    window.addEventListener('billing-invite-member', handler);
    return () => window.removeEventListener('billing-invite-member', handler);
  }, [teamId, isTeamOwner, user]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(collabLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !teamId || !isTeamOwner) return;

    setInviteStatus('loading');
    setInviteError('');

    try {
      // 1. Check if team is full (limit 10 members: owner + 9 members)
      const teamSnap = await getDoc(doc(db, 'teams', teamId));
      if (teamSnap.exists()) {
        const teamData = teamSnap.data();
        const currentSize = (teamData.members || []).length + 1;
        if (currentSize >= 10) {
          throw new Error('Team limit reached. Up to 10 seats allowed on Team Plan.');
        }
      }

      // 2. Find user in database by email
      const usersCol = collection(db, 'users');
      const q = query(usersCol, where('email', '==', inviteEmail.trim().toLowerCase()));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const targetUserDoc = snap.docs[0];
        const targetUid = targetUserDoc.id;

        if (targetUid === user?.id) {
          throw new Error('You cannot invite yourself.');
        }

        // Add to team members list
        const teamRef = doc(db, 'teams', teamId);
        await updateDoc(teamRef, {
          members: arrayUnion(targetUid)
        });

        // Set teamId on target user doc to cover their seat
        await updateDoc(targetUserDoc.ref, {
          teamId: teamId
        });

        setInviteStatus('success');
        setInviteEmail('');
        fetchTeamMembers();
      } else {
        // Invite email does not exist yet: create pending invite doc
        const invitesCol = collection(db, 'invites');
        await addDoc(invitesCol, {
          email: inviteEmail.trim().toLowerCase(),
          teamId: teamId,
          invitedBy: user?.id,
          createdAt: new Date().toISOString()
        });

        setInviteStatus('success');
        setInviteEmail('');
        showAlertDialog('Invitation Sent', `Invitation sent to ${inviteEmail}. Once they register, they will join the team workspace automatically!`);
      }
    } catch (err: any) {
      console.error(err);
      setInviteStatus('error');
      setInviteError(err.message || 'Failed to send invite.');
    }
  };

  const handleRemoveMember = async (targetUid: string) => {
    if (!teamId || !isTeamOwner) return;
    if (await showConfirmDialog('Remove Member', 'Are you sure you want to remove this team member? They will lose access to team documents.')) {
      try {
        const teamRef = doc(db, 'teams', teamId);
        await updateDoc(teamRef, {
          members: arrayRemove(targetUid)
        });

        // Remove teamId on user doc to downgrade them back to Free
        const targetUserRef = doc(db, 'users', targetUid);
        await updateDoc(targetUserRef, {
          teamId: null
        });

        fetchTeamMembers();
      } catch (e) {
        console.error('Failed to remove member:', e);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900/90 text-white p-6 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Share Document
          </h2>
          <p className="text-xs text-neutral-400 mt-1">Share this workspace project with your team.</p>
        </div>

        {/* Copy Link */}
        <div className="mb-6">
          <label className="text-[11px] font-bold text-neutral-400 uppercase block mb-2">Collaboration Link</label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={collabLink}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-neutral-300 select-all outline-none"
            />
            <button
              onClick={handleCopyLink}
              className="flex items-center justify-center p-2.5 bg-blue-500 hover:bg-blue-600 rounded-xl text-black font-semibold transition cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Invite Form */}
        {isTeamOwner ? (
          <form onSubmit={handleInvite} className="mb-6 border-t border-white/5 pt-5">
            <label className="text-[11px] font-bold text-neutral-400 uppercase block mb-2">Invite new co-author</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="email"
                  placeholder="name@company.com"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-blue-500"
                />
                <Mail className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              </div>
              <button
                type="submit"
                disabled={inviteStatus === 'loading'}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                {inviteStatus === 'loading' ? 'Inviting...' : 'Send Invite'}
              </button>
            </div>
            {inviteStatus === 'error' && (
              <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> {inviteError}</p>
            )}
            {inviteStatus === 'success' && (
              <p className="text-xs text-green-400 mt-2 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Invitation sent successfully!</p>
            )}
          </form>
        ) : (
          <div className="mb-6 p-3 rounded-xl border border-amber-500/10 bg-amber-500/[0.02] text-xs text-amber-500 flex items-start gap-2.5">
            <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>Only the Team Owner can invite new team members or manage seats.</p>
          </div>
        )}

        {/* Team Members List */}
        {teamId && (
          <div className="flex-1 overflow-y-auto min-h-0 border-t border-white/5 pt-5 flex flex-col">
            <label className="text-[11px] font-bold text-neutral-400 uppercase block mb-3">
              Team Workspace Seats ({teamMembers.length} / 10 used)
            </label>
            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {teamMembers.map((m) => (
                <div key={m.uid} className="flex items-center justify-between p-2.5 rounded-xl border border-white/5 bg-white/[0.01]">
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      {m.displayName}
                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${m.role === 'owner' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
                        {m.role}
                      </span>
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">{m.email}</div>
                  </div>
                  {isTeamOwner && m.role !== 'owner' && (
                    <button
                      onClick={() => handleRemoveMember(m.uid)}
                      className="p-1.5 hover:bg-red-500/10 text-neutral-400 hover:text-red-400 rounded-lg transition cursor-pointer"
                      title="Remove Member"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {loadingMembers && <div className="text-xs text-neutral-500 italic p-2">Loading seats list...</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

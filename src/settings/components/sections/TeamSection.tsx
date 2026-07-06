import React, { useState, useEffect } from 'react';
import { Users, ChevronDown, ChevronRight, Plus, Trash2, UserMinus, Mail, Shield, ShieldCheck } from 'lucide-react';
import { useAuth, db } from '../../../auth/AuthProvider';
import { usePlan } from '../../../billing/PlanProvider';
import type { TeamGroupsMap, TeamGroup, GroupPermissions } from '../../../auth/teamPermissions';
import { showConfirmDialog, showAlertDialog } from '../../../lib/tauriDialog';

export function TeamSection() {
  const { user } = useAuth();
  const { isTeamOwner, teamId, activeContext } = usePlan();

  const [setupTeamName, setSetupTeamName] = useState('');
  const [setupTeamDesc, setSetupTeamDesc] = useState('');
  const [setupTeamAgreement, setSetupTeamAgreement] = useState(`## Team Workspace Agreement\n\nBy joining this team, you agree to:\n1. Maintain confidentiality of all shared drafts.\n2. Follow standard editing guidelines.\n3. Respect access controls set by the team administrator.`);
  const [setupStatus, setSetupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [setupError, setSetupError] = useState('');

  const [editAgreementText, setEditAgreementText] = useState('');
  const [editAgreementStatus, setEditAgreementStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [editAgreementError, setEditAgreementError] = useState('');
  const [agreementDocId, setAgreementDocId] = useState<string | null>(null);

  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [inviteError, setInviteError] = useState('');

  const [groups, setGroups] = useState<TeamGroupsMap>({});
  const [groupsSaving, setGroupsSaving] = useState(false);
  const [groupsError, setGroupsError] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const fetchTeamData = async () => {
    if (!teamId) return;
    setLoadingMembers(true);
    try {
      const { doc: docRef, getDoc } = await import('firebase/firestore');
      const teamSnap = await getDoc(docRef(db, 'teams', teamId));
      if (teamSnap.exists()) {
        const teamData = teamSnap.data();
        setAgreementDocId(teamData.agreementDocId || null);
        setGroups(teamData.groups ?? {});
        if (teamData.agreementDocId) {
          const docSnap = await getDoc(docRef(db, 'cloud_documents', teamData.agreementDocId));
          if (docSnap.exists()) {
            const docData = docSnap.data();
            try { setEditAgreementText(JSON.parse(docData.content).markdown || JSON.parse(docData.content).draft || docData.content || ''); } catch { setEditAgreementText(docData.content || ''); }
          }
        }
        const memberIds = [teamData.ownerId, ...(teamData.members || [])];
        const membersList = [];
        for (const mId of memberIds) {
          const userSnap = await getDoc(docRef(db, 'users', mId));
          if (userSnap.exists()) { const data = userSnap.data(); membersList.push({ uid: mId, email: data.email || 'No email', displayName: data.displayName || 'Unknown User', role: mId === teamData.ownerId ? 'owner' : 'member' }); }
        }
        setMembers(membersList);
      }
    } catch (e) { console.error('Failed to load team data:', e); } finally { setLoadingMembers(false); }
  };

  useEffect(() => { if (teamId) fetchTeamData(); }, [teamId]);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupTeamName.trim() || !setupTeamAgreement.trim() || !user) return;
    setSetupStatus('loading'); setSetupError('');
    try {
      const { doc: docRef, setDoc, collection: colRef, updateDoc, arrayUnion } = await import('firebase/firestore');
      const newTeamRef = docRef(colRef(db, 'teams'));
      const newTeamId = newTeamRef.id;
      const agreementDocRef = docRef(colRef(db, 'cloud_documents'));
      const newAgreementDocId = agreementDocRef.id;
      await setDoc(newTeamRef, { ownerId: user.id, name: setupTeamName.trim(), description: setupTeamDesc.trim(), agreementDocId: newAgreementDocId, agreementVersion: 1, members: [], createdAt: new Date().toISOString() });
      await setDoc(agreementDocRef, { id: newAgreementDocId, ownerId: user.id, teamId: newTeamId, path: 'agreement', title: 'Agreement', content: JSON.stringify({ markdown: setupTeamAgreement.trim() }), stage: 'draft', focusMode: false, isAgreement: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await setDoc(docRef(db, 'users', user.id), { ownedTeamId: newTeamId, teamMemberships: arrayUnion(newTeamId), teamId: newTeamId }, { merge: true });
      setSetupStatus('success'); showAlertDialog('Team Created', `Team "${setupTeamName}" created successfully!`);
    } catch (err: any) { setSetupStatus('error'); setSetupError(err.message || 'Failed to create team.'); }
  };

  const handleUpdateAgreement = async () => {
    if (!agreementDocId || !teamId || !editAgreementText.trim()) return;
    setEditAgreementStatus('loading'); setEditAgreementError('');
    try {
      const { doc: docRef, updateDoc, getDoc } = await import('firebase/firestore');
      await updateDoc(docRef(db, 'cloud_documents', agreementDocId), { content: JSON.stringify({ markdown: editAgreementText.trim() }), updatedAt: new Date().toISOString() });
      const teamSnap = await getDoc(docRef(db, 'teams', teamId));
      const currentVersion = teamSnap.exists() ? (teamSnap.data().agreementVersion || 1) : 1;
      await updateDoc(docRef(db, 'teams', teamId), { agreementVersion: currentVersion + 1 });
      setEditAgreementStatus('success'); showAlertDialog('Agreement Updated', 'Agreement updated!');
    } catch (err: any) { setEditAgreementStatus('error'); setEditAgreementError(err.message || 'Failed.'); }
  };

  const handleRemoveMember = async (targetUid: string) => {
    if (!teamId || !isTeamOwner) return;
    if (!(await showConfirmDialog('Remove Member', 'Remove this member? They will lose access to team documents.'))) return;
    try {
      const { doc: docRef, updateDoc, arrayRemove } = await import('firebase/firestore');
      await updateDoc(docRef(db, 'teams', teamId), { members: arrayRemove(targetUid) });
      await updateDoc(docRef(db, 'users', targetUid), { teamId: null, teamMemberships: arrayRemove(teamId) });
      fetchTeamData();
    } catch (e) { console.error('Failed to remove member:', e); }
  };

  const handleCreateGroup = () => {
    const id = `group_${Date.now()}`;
    setGroups(prev => ({ ...prev, [id]: { name: 'New Group', members: [], permissions: { openLocalFiles: false, createFiles: false, createFolders: false, renameFiles: false, deleteFiles: false, export: false, addToTeam: false, offlineAccess: true } } }));
    setExpandedGroupId(id);
  };

  const handleDeleteGroup = async (id: string) => {
    if (!(await showConfirmDialog('Delete Group', 'Delete this group?'))) return;
    setGroups(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const PERMS: { key: keyof GroupPermissions; label: string }[] = [
    { key: 'openLocalFiles', label: 'Open Local Files' }, { key: 'createFiles', label: 'Create Files' }, { key: 'createFolders', label: 'Create Folders' },
    { key: 'renameFiles', label: 'Rename Files' }, { key: 'deleteFiles', label: 'Delete Files' }, { key: 'export', label: 'Export Documents' },
    { key: 'addToTeam', label: 'Add to Team' }, { key: 'offlineAccess', label: 'Offline Access' },
  ];

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <Users className="w-5 h-5 text-orange-500" /> Team Workspace Settings
      </h3>

      {isTeamOwner && !teamId && (
        <form onSubmit={handleCreateTeam} className="space-y-4 border border-black/5 dark:border-white/5 rounded-2xl p-6 bg-black/5 dark:bg-white/2">
          <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Team Name</label><input type="text" required placeholder="Design Studio" value={setupTeamName} onChange={(e) => setSetupTeamName(e.target.value)} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500" /></div>
          <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Description (Optional)</label><textarea placeholder="Collaborative workspace..." value={setupTeamDesc} onChange={(e) => setSetupTeamDesc(e.target.value)} rows={2} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 resize-none" /></div>
          <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Membership Agreement (Markdown)</label><textarea required value={setupTeamAgreement} onChange={(e) => setSetupTeamAgreement(e.target.value)} rows={8} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 font-mono" /></div>
          <button type="submit" disabled={setupStatus === 'loading'} className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-black font-bold text-xs rounded-xl shadow-lg transition cursor-pointer disabled:opacity-50">
            {setupStatus === 'loading' ? 'Creating...' : 'Create Team Workspace'}
          </button>
          {setupStatus === 'error' && <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> {setupError}</p>}
        </form>
      )}

      {isTeamOwner && teamId && (
        <div className="space-y-6">
          <div className="border border-black/5 dark:border-white/5 rounded-2xl p-5">
            <span className="text-xs font-bold text-gray-400 block mb-4 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Team Members ({members.length} / 10 seats)</span>
            <div className="space-y-2 mb-4">
              {members.map((m) => (
                <div key={m.uid} className="flex items-center justify-between p-2.5 rounded-xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/2">
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5 text-white">{m.displayName} <span className={`text-[8px] uppercase px-1.5 py-0.5 rounded font-bold ${m.role === 'owner' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>{m.role}</span></div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{m.email}</div>
                  </div>
                  {m.role !== 'owner' && <button onClick={() => handleRemoveMember(m.uid)} className="p-1.5 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-lg transition cursor-pointer" title="Remove"><UserMinus className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
              {loadingMembers && <div className="text-xs text-neutral-500 italic">Loading members...</div>}
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault(); if (!inviteEmail.trim()) return; setInviteStatus('loading'); setInviteError('');
              try {
                const { getAuth } = await import('firebase/auth');
                const auth = getAuth(); const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
                const baseUrl = import.meta.env.VITE_MODAL_BASE_URL || '';
                const res = await fetch(`${baseUrl}/invite-member`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), teamId }) });
                if (!res.ok) throw new Error(`Server error: ${await res.text()}`);
                setInviteStatus('success'); setInviteEmail(''); fetchTeamData();
              } catch (err: any) { setInviteStatus('error'); setInviteError(err.message || 'Failed.'); }
            }}>
              <label className="text-[11px] font-bold text-gray-400 uppercase block mb-2">Invite new member</label>
              <div className="flex gap-2">
                <div className="relative flex-1"><input type="email" placeholder="teammate@company.com" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-blue-500" /><Mail className="w-4 h-4 opacity-40 absolute left-3 top-2.5" /></div>
                <button type="submit" disabled={inviteStatus === 'loading'} className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50">{inviteStatus === 'loading' ? 'Inviting...' : 'Invite'}</button>
              </div>
              {inviteStatus === 'error' && <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> {inviteError}</p>}
              {inviteStatus === 'success' && <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Invite sent!</p>}
            </form>
          </div>

          <div className="border border-black/5 dark:border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-gray-400 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Permission Groups</span>
              <div className="flex items-center gap-2">
                {groupsError && <span className="text-[10px] text-red-400">{groupsError}</span>}
                <button onClick={async () => { if (!teamId) return; setGroupsSaving(true); setGroupsError(''); try { const { doc: docRef, updateDoc } = await import('firebase/firestore'); await updateDoc(docRef(db, 'teams', teamId), { groups }); } catch (e: any) { setGroupsError(e.message || 'Failed.'); } finally { setGroupsSaving(false); } }} disabled={groupsSaving} className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white text-[11px] font-bold rounded-xl transition cursor-pointer disabled:opacity-50">{groupsSaving ? 'Saving…' : 'Save Groups'}</button>
                <button onClick={handleCreateGroup} className="px-3 py-1.5 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl text-[11px] font-semibold hover:bg-black/10 dark:hover:bg-white/10 transition cursor-pointer flex items-center gap-1"><Plus className="w-3 h-3" /> New Group</button>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 opacity-70">Groups control what team members can do. Effective permissions are the union of all groups a member belongs to.</p>
            {Object.keys(groups).length === 0 && <div className="text-xs text-gray-400 italic text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-xl">No groups yet.</div>}
            <div className="space-y-3">
              {(Object.entries(groups) as [string, TeamGroup][]).map(([gid, group]) => (
                <div key={gid} className="border border-black/5 dark:border-white/5 rounded-xl overflow-hidden">
                  <button onClick={() => setExpandedGroupId(expandedGroupId === gid ? null : gid)} className="w-full flex items-center justify-between px-4 py-3 bg-black/3 dark:bg-white/3 hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer">
                    <div className="flex items-center gap-2">
                      {expandedGroupId === gid ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                      <Users className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-semibold text-[var(--editor-text-color)]">{group.name || 'Unnamed Group'}</span>
                      <span className="text-[10px] text-gray-400 opacity-60">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(gid); }} className="p-1 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-lg transition cursor-pointer" title="Delete group"><Trash2 className="w-3 h-3" /></button>
                  </button>
                  {expandedGroupId === gid && (
                    <div className="px-4 py-4 space-y-5 border-t border-black/5 dark:border-white/5">
                      <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Group Name</label><input type="text" value={group.name} onChange={(e) => setGroups(prev => ({ ...prev, [gid]: { ...prev[gid], name: e.target.value } }))} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[var(--editor-text-color)] outline-none focus:border-purple-500" placeholder="e.g. Editors, Viewers…" /></div>
                      <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-2">Permissions</label>
                        <div className="grid grid-cols-2 gap-2">
                          {PERMS.map(({ key, label }) => (
                            <label key={key} className="flex items-center gap-2 p-2.5 rounded-xl bg-black/3 dark:bg-white/3 border border-black/5 dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition">
                              <input type="checkbox" checked={!!group.permissions[key]} onChange={() => setGroups(prev => ({ ...prev, [gid]: { ...prev[gid], permissions: { ...prev[gid].permissions, [key]: !prev[gid].permissions[key] } } }))} className="w-3.5 h-3.5 accent-purple-500" />
                              <span className="text-[11px] text-[var(--editor-text-color)] font-medium">{label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-2">Members in this Group</label>
                        {members.filter(m => m.role !== 'owner').length === 0 ? <p className="text-[11px] text-gray-400 italic">No members to assign yet.</p> : (
                          <div className="space-y-1.5">
                            {members.filter(m => m.role !== 'owner').map(m => (
                              <label key={m.uid} className="flex items-center gap-2.5 p-2 rounded-xl bg-black/3 dark:bg-white/3 border border-black/5 dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition">
                                <input type="checkbox" checked={group.members.includes(m.uid)} onChange={() => setGroups(prev => { const g = prev[gid]; return { ...prev, [gid]: { ...g, members: g.members.includes(m.uid) ? g.members.filter(x => x !== m.uid) : [...g.members, m.uid] } }; })} className="w-3.5 h-3.5 accent-purple-500" />
                                <div className="min-w-0"><div className="text-[11px] font-semibold text-[var(--editor-text-color)] truncate">{m.displayName}</div><div className="text-[10px] text-gray-400 truncate">{m.email}</div></div>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border border-black/5 dark:border-white/5 rounded-2xl p-5 space-y-3">
            <label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Edit Team Agreement (Markdown)</label>
            <textarea value={editAgreementText} onChange={(e) => setEditAgreementText(e.target.value)} rows={8} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 font-mono" />
            <button onClick={handleUpdateAgreement} disabled={editAgreementStatus === 'loading'} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-black font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-50">
              {editAgreementStatus === 'loading' ? 'Updating...' : 'Update Agreement'}
            </button>
            {editAgreementStatus === 'error' && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> {editAgreementError}</p>}
            {editAgreementStatus === 'success' && <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Agreement updated!</p>}
          </div>
        </div>
      )}

      {!isTeamOwner && teamId && (
        <div className="border border-blue-500/10 bg-blue-500/3 rounded-2xl p-5 text-xs text-left">
          <p className="font-semibold mb-1 flex items-center gap-1.5 text-blue-400 font-bold"><ShieldCheck className="w-4 h-4" /> Covered by Team Workspace</p>
          <p className="opacity-60 mb-4">Your access and features are covered under your team owner's subscription.</p>
          <button onClick={fetchTeamData} className="px-4 py-2 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-semibold hover:bg-black/10 dark:hover:bg-white/10 text-white transition cursor-pointer">Refresh Workspace Info</button>
        </div>
      )}
    </div>
  );
}

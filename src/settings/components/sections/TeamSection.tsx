import React, { useState, useEffect } from 'react';
import { Users, ChevronDown, ChevronRight, Plus, Trash2, UserMinus, Mail, Shield, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../auth/AuthProvider';
import { useData } from '../../../data/DataProvider';
import { usePlan } from '../../../billing/PlanProvider';
import type { TeamGroupsMap, TeamGroup, GroupPermissions } from '../../../auth/teamPermissions';
import { showConfirmDialog, showAlertDialog } from '../../../lib/tauriDialog';

const i = (cls: string) => cls;

export function TeamSection() {
  const { user } = useAuth();
  const { isTeamOwner, teamId } = usePlan();
  const { teams, users, cloudDocuments } = useData();
  const [st, setSt] = useState({ name: '', desc: '', agreement: `## Team Workspace Agreement\n\n...`, status: 'idle' as any, error: '' });
  const [ea, setEa] = useState({ text: '', status: 'idle' as any, error: '', docId: null as string | null });
  const [members, setM] = useState<any[]>([]);
  const [lm, setLm] = useState(false);
  const [ie, setIe] = useState({ email: '', status: 'idle' as any, error: '' });
  const [groups, setG] = useState<TeamGroupsMap>({});
  const [gs, setGs] = useState({ saving: false, error: '' });
  const [expandedGid, setExpandedGid] = useState<string | null>(null);

  const fetchTeamData = async () => {
    if (!teamId) return;
    setLm(true);
    try {
      const team = await teams.get(teamId);
      if (!team) { setLm(false); return; }

      setEa(p => ({ ...p, docId: team.agreementDocId || null }));
      setG(team.groups ?? {});

      if (team.agreementDocId) {
        const text = await cloudDocuments.getText(team.agreementDocId);
        setEa(p => ({ ...p, text: text ?? '' }));
      }

      // From the team's membership records rather than each member's user
      // document — those are self-readable only now.
      const roster = await teams.listMembers(teamId);
      setM(roster.map(member => ({
        uid: member.uid,
        email: member.email || 'No email',
        displayName: member.displayName || 'Unknown User',
        role: member.uid === team.ownerId ? 'owner' : 'member',
      })));
    } catch (e) { console.error(e); } finally { setLm(false); }
  };

  useEffect(() => { if (teamId) fetchTeamData(); }, [teamId]);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!st.name.trim() || !st.agreement.trim() || !user) return;
    setSt(p => ({ ...p, status: 'loading', error: '' }));
    try {
      await teams.create({
        ownerId: user.id,
        name: st.name.trim(),
        description: st.desc.trim(),
        agreementMarkdown: st.agreement.trim(),
      });
      setSt(p => ({ ...p, status: 'success' })); showAlertDialog('Team Created', `Team created!`);
    } catch (err: any) { setSt(p => ({ ...p, status: 'error', error: err.message })); }
  };

  const handleRemoveMember = async (uid: string) => {
    if (!teamId || !isTeamOwner) return;
    if (!(await showConfirmDialog('Remove Member', 'Remove this member?'))) return;
    try {
      await teams.removeMember(teamId, uid);
      fetchTeamData();
    } catch (e) { console.error(e); }
  };

  const defaultPerms = { openLocalFiles: false, createFiles: false, createFolders: false, renameFiles: false, deleteFiles: false, export: false, addToTeam: false, offlineAccess: true, gitInit: false, gitCommit: false, gitPush: false, gitPull: false, gitBranch: false };
  const handleCreateGroup = () => {
    const id = `g_${Date.now()}`;
    setG(p => ({ ...p, [id]: { name: 'New Group', members: [], permissions: { ...defaultPerms } } }));
    setExpandedGid(id);
  };
  const handleDeleteGroup = async (id: string) => {
    if (!(await showConfirmDialog('Delete Group', 'Delete this group?'))) return;
    setG(p => { const n = { ...p }; delete n[id]; return n; });
  };

  const permGroups: { label: string; items: { key: keyof GroupPermissions; label: string }[] }[] = [
    { label: 'Files', items: [{ key: 'openLocalFiles', label: 'Open Local' }, { key: 'createFiles', label: 'Create' }, { key: 'createFolders', label: 'Folders' }, { key: 'renameFiles', label: 'Rename' }, { key: 'deleteFiles', label: 'Delete' }] },
    { label: 'Collab', items: [{ key: 'addToTeam', label: 'Add to Team' }, { key: 'export', label: 'Export' }, { key: 'offlineAccess', label: 'Offline' }] },
    { label: 'Git', items: [{ key: 'gitInit', label: 'Init' }, { key: 'gitCommit', label: 'Commit' }, { key: 'gitPush', label: 'Push' }, { key: 'gitPull', label: 'Pull' }, { key: 'gitBranch', label: 'Branch' }] },
  ];

  const b = (s: string) => 'border border-black/5 dark:border-white/5 ' + s;
  const bg = (s: string) => 'bg-black/5 dark:bg-white/5 ' + s;

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-orange-500" /> Team Workspace Settings</h3>

      {isTeamOwner && !teamId && (
        <form onSubmit={handleCreateTeam} className="space-y-4 border border-black/5 dark:border-white/5 rounded-2xl p-6 bg-black/5 dark:bg-white/2">
          <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Team Name</label><input type="text" required placeholder="Design Studio" value={st.name} onChange={e => setSt(p => ({ ...p, name: e.target.value }))} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500" /></div>
          <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Description (Optional)</label><textarea placeholder="Collaborative workspace..." value={st.desc} onChange={e => setSt(p => ({ ...p, desc: e.target.value }))} rows={2} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 resize-none" /></div>
          <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Membership Agreement (Markdown)</label><textarea required value={st.agreement} onChange={e => setSt(p => ({ ...p, agreement: e.target.value }))} rows={8} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 font-mono" /></div>
          <button type="submit" disabled={st.status === 'loading'} className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-black font-bold text-xs rounded-xl shadow-lg transition cursor-pointer disabled:opacity-50">{st.status === 'loading' ? 'Creating...' : 'Create Team Workspace'}</button>
          {st.status === 'error' && <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> {st.error}</p>}
        </form>
      )}

      {isTeamOwner && teamId && (
        <div className="space-y-6">
          <div className={b('rounded-2xl p-5')}>
            <span className="text-xs font-bold text-gray-400 block mb-4 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Team Members ({members.length} / 10 seats)</span>
            <div className="space-y-2 mb-4">
              {members.map(m => (
                <div key={m.uid} className="flex items-center justify-between p-2.5 rounded-xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/2">
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5 text-white">{m.displayName} <span className={`text-[8px] uppercase px-1.5 py-0.5 rounded font-bold ${m.role === 'owner' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>{m.role}</span></div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{m.email}</div>
                  </div>
                  {m.role !== 'owner' && <button onClick={() => handleRemoveMember(m.uid)} className="p-1.5 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-lg transition cursor-pointer" title="Remove"><UserMinus className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
              {lm && <div className="text-xs text-neutral-500 italic">Loading members...</div>}
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault(); if (!ie.email.trim()) return; setIe(p => ({ ...p, status: 'loading', error: '' }));
              try {
                const auth = (await import('firebase/auth')).getAuth(); const tok = auth.currentUser ? await auth.currentUser.getIdToken() : null;
                const base = import.meta.env.VITE_MODAL_BASE_URL || '';
                const res = await fetch(`${base}/invite-member`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ email: ie.email.trim().toLowerCase(), teamId }) });
                if (!res.ok) throw new Error(await res.text());
                setIe(p => ({ ...p, status: 'success', email: '' })); fetchTeamData();
              } catch (err: any) { setIe(p => ({ ...p, status: 'error', error: err.message })); }
            }}>
              <label className="text-[11px] font-bold text-gray-400 uppercase block mb-2">Invite new member</label>
              <div className="flex gap-2">
                <div className="relative flex-1"><input type="email" placeholder="teammate@company.com" required value={ie.email} onChange={e => setIe(p => ({ ...p, email: e.target.value }))} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-blue-500" /><Mail className="w-4 h-4 opacity-40 absolute left-3 top-2.5" /></div>
                <button type="submit" disabled={ie.status === 'loading'} className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50">{ie.status === 'loading' ? 'Inviting...' : 'Invite'}</button>
              </div>
              {ie.status === 'error' && <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> {ie.error}</p>}
              {ie.status === 'success' && <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Invite sent!</p>}
            </form>
          </div>

          <div className={b('rounded-2xl p-5 space-y-4')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-gray-400 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Permission Groups</span>
              <div className="flex items-center gap-2">
                {gs.error && <span className="text-[10px] text-red-400">{gs.error}</span>}
                <button onClick={async () => { if (!teamId) return; setGs(p => ({ ...p, saving: true, error: '' })); try { await teams.updateGroups(teamId, groups); } catch (e: any) { setGs(p => ({ ...p, error: e.message })); } finally { setGs(p => ({ ...p, saving: false })); } }} disabled={gs.saving} className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white text-[11px] font-bold rounded-xl transition cursor-pointer disabled:opacity-50">{gs.saving ? 'Saving...' : 'Save Groups'}</button>
                <button onClick={handleCreateGroup} className="px-3 py-1.5 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl text-[11px] font-semibold hover:bg-black/10 dark:hover:bg-white/10 transition cursor-pointer flex items-center gap-1"><Plus className="w-3 h-3" /> New Group</button>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 opacity-70">Permissions are the union of all groups a member belongs to.</p>
            {Object.keys(groups).length === 0 && <div className="text-xs text-gray-400 italic text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-xl">No groups yet.</div>}
            <div className="space-y-3">
              {(Object.entries(groups) as [string, TeamGroup][]).map(([gid, group]) => (
                <div key={gid} className={b('rounded-xl overflow-hidden')}>
                  <button onClick={() => setExpandedGid(expandedGid === gid ? null : gid)} className="w-full flex items-center justify-between px-4 py-3 bg-black/3 dark:bg-white/3 hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer">
                    <div className="flex items-center gap-2">
                      {expandedGid === gid ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                      <Users className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-semibold text-[var(--editor-text-color)]">{group.name || 'Unnamed Group'}</span>
                      <span className="text-[10px] text-gray-400 opacity-60">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</span>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleDeleteGroup(gid); }} className="p-1 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-lg transition cursor-pointer" title="Delete group"><Trash2 className="w-3 h-3" /></button>
                  </button>
                  {expandedGid === gid && (
                    <div className="px-4 py-4 space-y-5 border-t border-black/5 dark:border-white/5">
                      <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-1.5">Group Name</label><input type="text" value={group.name} onChange={e => setG(p => ({ ...p, [gid]: { ...p[gid], name: e.target.value } }))} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[var(--editor-text-color)] outline-none focus:border-purple-500" placeholder="e.g. Editors, Viewers..." /></div>
                      <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-2">Permissions</label>
                        {permGroups.map(pg => (
                          <div key={pg.label} className="mb-3">
                            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">{pg.label}</span>
                            <div className="grid grid-cols-2 gap-1.5">
                              {pg.items.map(({ key, label }) => (
                                <label key={key} className="flex items-center gap-2 p-2 rounded-xl bg-black/3 dark:bg-white/3 border border-black/5 dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition">
                                  <input type="checkbox" checked={!!group.permissions[key]} onChange={() => setG(p => ({ ...p, [gid]: { ...p[gid], permissions: { ...p[gid].permissions, [key]: !p[gid].permissions[key] } } }))} className="w-3.5 h-3.5 accent-purple-500" />
                                  <span className="text-[11px] text-[var(--editor-text-color)] font-medium">{label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div><label className="text-[11px] font-bold text-gray-400 uppercase block mb-2">Members in this Group</label>
                        {members.filter(m => m.role !== 'owner').length === 0 ? <p className="text-[11px] text-gray-400 italic">No members to assign yet.</p> : (
                          <div className="space-y-1.5">
                            {members.filter(m => m.role !== 'owner').map(m => (
                              <label key={m.uid} className="flex items-center gap-2.5 p-2 rounded-xl bg-black/3 dark:bg-white/3 border border-black/5 dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition">
                                <input type="checkbox" checked={group.members.includes(m.uid)} onChange={() => setG(p => { const g = p[gid]; return { ...p, [gid]: { ...g, members: g.members.includes(m.uid) ? g.members.filter(x => x !== m.uid) : [...g.members, m.uid] } }; })} className="w-3.5 h-3.5 accent-purple-500" />
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
        </div>
      )}

      {!isTeamOwner && teamId && (
        <div className="border border-blue-500/10 bg-blue-500/3 rounded-2xl p-5 text-xs text-left">
          <p className="font-semibold mb-1 flex items-center gap-1.5 text-blue-400 font-bold"><ShieldCheck className="w-4 h-4" /> Covered by Team Workspace</p>
          <p className="opacity-60 mb-4">Your access is covered under your team owner's subscription.</p>
          <button onClick={fetchTeamData} className="px-4 py-2 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-semibold hover:bg-black/10 dark:hover:bg-white/10 text-white transition cursor-pointer">Refresh Workspace Info</button>
        </div>
      )}
    </div>
  );
}

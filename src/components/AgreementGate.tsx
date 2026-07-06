import React, { useState, useEffect, useRef } from 'react';
import { usePlan } from '../billing/PlanProvider';
import { useAuth } from '../auth/AuthProvider';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../auth/firebase';
import { markdown } from '../editor/extensions/inlinePreview/markdown';
import { ShieldAlert, FileText, Check } from 'lucide-react';
import { showAlertDialog } from '../lib/tauriDialog';

export function AgreementGate() {
  const { activeContext, teamId, ownedTeamId } = usePlan();
  const { user } = useAuth();

  const [teamDoc, setTeamDoc] = useState<any>(null);
  const [agreementDoc, setAgreementDoc] = useState<any>(null);
  const [agreementContent, setAgreementContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [signing, setSigning] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to team and agreement doc if team context is active
  useEffect(() => {
    if (activeContext.type !== 'team' || !teamId || !user) {
      setTeamDoc(null);
      setAgreementDoc(null);
      setAgreementContent('');
      return;
    }

    setLoading(true);

    // 1. Subscribe to team settings
    const teamRef = doc(db, 'teams', teamId);
    const unsubTeam = onSnapshot(teamRef, (snap) => {
      if (snap.exists()) {
        const teamData = snap.data();
        setTeamDoc(teamData);

        // Fetch the actual agreement document markdown content
        if (teamData.agreementDocId) {
          getDoc(doc(db, 'cloud_documents', teamData.agreementDocId)).then((docSnap) => {
            if (docSnap.exists()) {
              const docData = docSnap.data();
              // Parse Yjs or plain text. In firestoreSync we save Yjs text, but let's extract content.
              let text = '';
              try {
                // If it is JSON-encoded Yjs content
                const parsed = JSON.parse(docData.content);
                text = parsed.markdown || parsed.draft || docData.content || '';
              } catch (e) {
                text = docData.content || '';
              }
              setAgreementContent(text || 'No agreement content found.');
            } else {
              setAgreementContent('Agreement document not found on server.');
            }
          });
        }
      }
    });

    // 2. Subscribe to signed agreement info
    const agreementRef = doc(db, 'agreements', `${teamId}_${user.id}`);
    const unsubAgreement = onSnapshot(agreementRef, (snap) => {
      if (snap.exists()) {
        setAgreementDoc(snap.data());
      } else {
        setAgreementDoc(null);
      }
      setLoading(false);
    });

    return () => {
      unsubTeam();
      unsubAgreement();
    };
  }, [activeContext, teamId, user]);

  // Handle scroll detection
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // If user scrolled to within 15px of the bottom
      if (scrollHeight - scrollTop - clientHeight < 15) {
        setScrolledToBottom(true);
      }
    }
  };

  // On content load, check if it fits without scrolling
  useEffect(() => {
    if (agreementContent && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      if (scrollHeight <= clientHeight + 10) {
        setScrolledToBottom(true);
      }
    }
  }, [agreementContent]);

  const handleAgree = async () => {
    if (!isChecked || !user || !teamId || !teamDoc) return;
    setSigning(true);
    try {
      const agreementId = `${teamId}_${user.id}`;
      await setDoc(doc(db, 'agreements', agreementId), {
        teamId,
        uid: user.id,
        signedAt: new Date().toISOString(),
        agreementVersion: teamDoc.agreementVersion || 1,
        agreementDocId: teamDoc.agreementDocId
      });
    } catch (e) {
      console.error('Failed to sign team agreement:', e);
      showAlertDialog('Sign Error', 'Failed to sign agreement. Please try again.');
    } finally {
      setSigning(false);
    }
  };

  // Determine if gate should block workspace access
  const isOwner = ownedTeamId === teamId;
  const isSigned = agreementDoc && teamDoc && agreementDoc.agreementVersion >= teamDoc.agreementVersion;
  const showGate = activeContext.type === 'team' && teamId && user && !isOwner && !isSigned && !loading;

  if (!showGate) return null;

  const renderedHtml = markdown.render(agreementContent || 'Loading terms of agreement...');

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-900/90 text-white p-8 shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 flex-shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Action Required: Team Membership Agreement
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              Before entering the <strong>"{activeContext.teamName || 'Team'}"</strong> workspace, you must review and agree to their terms of service.
            </p>
          </div>
        </div>

        {/* Agreement content box */}
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto min-h-0 bg-black/20 border border-white/5 rounded-2xl p-5 mb-6 text-xs text-neutral-300 leading-relaxed scrollbar-thin select-text"
        >
          <div 
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
            className="prose prose-invert max-w-none text-left"
          />
        </div>

        {/* Action Controls */}
        <div className="border-t border-white/5 pt-5 flex flex-col gap-4">
          {!scrolledToBottom && (
            <p className="text-[11px] text-amber-400/90 text-center font-medium flex items-center justify-center gap-1">
              <FileText className="w-3.5 h-3.5" /> Please scroll to the bottom of the agreement to enable signing.
            </p>
          )}

          <div className="flex items-center justify-between flex-wrap gap-4">
            <label className={`flex items-center gap-2.5 text-xs font-medium cursor-pointer transition select-none ${scrolledToBottom ? 'text-neutral-200' : 'text-neutral-500 pointer-events-none'}`}>
              <input
                type="checkbox"
                disabled={!scrolledToBottom}
                checked={isChecked}
                onChange={(e) => setIsChecked(e.target.checked)}
                className="w-4 h-4 rounded border-white/10 bg-white/5 text-amber-500 focus:ring-0 cursor-pointer disabled:opacity-30"
              />
              <span>I have read and agree to the membership terms outlined above.</span>
            </label>

            <button
              onClick={handleAgree}
              disabled={!isChecked || signing}
              className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-black font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-lg shadow-orange-500/10 active:scale-[0.98]"
            >
              {signing ? 'Signing...' : (
                <>
                  <Check className="w-4 h-4" /> Agree &amp; Continue
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

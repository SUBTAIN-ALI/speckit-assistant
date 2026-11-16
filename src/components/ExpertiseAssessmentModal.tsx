'use client';

import React, { useState } from 'react';
import { X, Code2, Briefcase, HelpCircle, BookOpen } from 'lucide-react';
import type { TechnicalLevel, DomainKnowledge, UserExpertiseProfile } from '@/domain/models/types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profile: UserExpertiseProfile) => void;
  current?: UserExpertiseProfile | null;
};

const MODE_LABELS: Record<string, { title: string; description: string }> = {
  'power-user': {
    title: 'Power User',
    description: 'Full technical specs with standard terminology. No hand-holding.',
  },
  'domain-transfer': {
    title: 'Domain Transfer',
    description: 'Technical language is fine, but business terms and domain concepts will be explained.',
  },
  'tech-shield': {
    title: 'Business-Friendly',
    description: 'Plain language, user stories, no code or architecture jargon. Your domain knowledge is leveraged.',
  },
  'full-guidance': {
    title: 'Full Guidance',
    description: 'Everything explained in simple terms — both the business domain and the technical side.',
  },
};

export const ExpertiseAssessmentModal: React.FC<Props> = ({ isOpen, onClose, onSave, current }) => {
  const [technicalLevel, setTechnicalLevel] = useState<TechnicalLevel | null>(current?.technicalLevel ?? null);
  const [domainKnowledge, setDomainKnowledge] = useState<DomainKnowledge | null>(current?.domainKnowledge ?? null);
  const [domainContext, setDomainContext] = useState<string>(current?.domainContext ?? '');
  const [step, setStep] = useState<1 | 2 | 3>(1);

  if (!isOpen) return null;

  const canProceedStep1 = technicalLevel !== null;
  const canProceedStep2 = domainKnowledge !== null;

  const computeMode = () => {
    if (technicalLevel === 'technical' && domainKnowledge === 'has-domain') return 'power-user';
    if (technicalLevel === 'technical' && domainKnowledge === 'no-domain') return 'domain-transfer';
    if (technicalLevel === 'non-technical' && domainKnowledge === 'has-domain') return 'tech-shield';
    return 'full-guidance';
  };

  const handleSave = () => {
    if (!technicalLevel || !domainKnowledge) return;
    const mode = computeMode();
    onSave({
      technicalLevel,
      domainKnowledge,
      domainContext: domainContext.trim() || undefined,
      mode,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 w-full max-w-md rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight">
              {step === 3 ? 'Your Profile' : 'Tell us about yourself'}
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {step === 3
                ? 'We\'ll adapt how we communicate based on this.'
                : `Step ${step} of 2 — This helps us tailor the experience for you.`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 dark:text-zinc-400 transition">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5">
          {/* Step 1: Technical Level */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Are you comfortable with software development concepts like APIs, databases, and code architecture?
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => setTechnicalLevel('technical')}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition ${
                    technicalLevel === 'technical'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-400'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  <Code2 size={18} className={`mt-0.5 flex-shrink-0 ${technicalLevel === 'technical' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">Yes, I'm technical</div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Developer, architect, engineering manager, or similar technical role.
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setTechnicalLevel('non-technical')}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition ${
                    technicalLevel === 'non-technical'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-400'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  <Briefcase size={18} className={`mt-0.5 flex-shrink-0 ${technicalLevel === 'non-technical' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">No, I'm non-technical</div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Product manager, business analyst, domain expert, or stakeholder.
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Domain Knowledge */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Do you already understand the business domain your project is about — the industry terms, regulations, and workflows?
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => setDomainKnowledge('has-domain')}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition ${
                    domainKnowledge === 'has-domain'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-400'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  <BookOpen size={18} className={`mt-0.5 flex-shrink-0 ${domainKnowledge === 'has-domain' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">Yes, I know this domain</div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      I understand the industry terms, business rules, and workflows.
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setDomainKnowledge('no-domain')}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition ${
                    domainKnowledge === 'no-domain'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-400'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  <HelpCircle size={18} className={`mt-0.5 flex-shrink-0 ${domainKnowledge === 'no-domain' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">No, this domain is new to me</div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      I'm not familiar with the industry jargon or business processes yet.
                    </div>
                  </div>
                </button>
              </div>

              {domainKnowledge !== null && (
                <div className="mt-3">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    What domain is this project about? (optional)
                  </label>
                  <input
                    type="text"
                    value={domainContext}
                    onChange={(e) => setDomainContext(e.target.value)}
                    placeholder="e.g. healthcare billing, e-commerce, fintech"
                    className="mt-1 w-full px-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white placeholder-zinc-400"
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 3 && technicalLevel && domainKnowledge && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${
                    computeMode() === 'power-user' ? 'bg-green-500' :
                    computeMode() === 'domain-transfer' ? 'bg-blue-500' :
                    computeMode() === 'tech-shield' ? 'bg-amber-500' : 'bg-purple-500'
                  }`} />
                  <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                    {MODE_LABELS[computeMode()].title}
                  </span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {MODE_LABELS[computeMode()].description}
                </p>
                {domainContext.trim() && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2">
                    Domain: <span className="font-medium text-zinc-700 dark:text-zinc-300">{domainContext.trim()}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-zinc-500 w-24">Technical:</span>
                  <span>{technicalLevel === 'technical' ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-zinc-500 w-24">Domain:</span>
                  <span>{domainKnowledge === 'has-domain' ? 'Knows domain' : 'New to domain'}</span>
                </div>
              </div>

              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
                You can change this anytime from the sidebar settings.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep((step - 1) as 1 | 2)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition"
            >
              Skip
            </button>
            {step === 1 && (
              <button
                onClick={() => canProceedStep1 && setStep(2)}
                disabled={!canProceedStep1}
                className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => canProceedStep2 && setStep(3)}
                disabled={!canProceedStep2}
                className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExpertiseAssessmentModal;

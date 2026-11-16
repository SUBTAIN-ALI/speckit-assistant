'use client';

import React, { useState } from 'react';
import { X, Globe, Chrome, CheckCircle2, ExternalLink, Play, Settings } from 'lucide-react';
import { BrowserTestStatus, BrowserTestResult } from '../domain/models/browserTest';

type ChromeExtensionGuideModalProps = {
  isOpen: boolean;
  onClose: () => void;
  featureName: string;
  onRunTest: (serverUrl: string) => void;
  testStatus: BrowserTestStatus | null;
  testResult: BrowserTestResult | null;
};

export const ChromeExtensionGuideModal: React.FC<ChromeExtensionGuideModalProps> = ({
  isOpen,
  onClose,
  featureName,
  onRunTest,
  testStatus,
  testResult,
}) => {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const isRunning = testStatus === 'running' || testStatus === 'checking-chrome';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 w-full max-w-md rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <Globe size={18} className="text-teal-600 dark:text-teal-400" />
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight">Browser Test</h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{featureName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 dark:text-zinc-400 transition">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!testResult && (
            <>
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Prerequisites</div>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Chrome size={14} className="mt-0.5 shrink-0 text-zinc-500" />
                    <span>Install the <strong>Claude in Chrome</strong> extension and connect it to your Claude Code session.</span>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Settings size={14} className="mt-0.5 shrink-0 text-zinc-500" />
                    <span>Grant the extension access to <strong>localhost</strong> in its site permissions.</span>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Play size={14} className="mt-0.5 shrink-0 text-zinc-500" />
                    <span>Make sure your dev server is running at the URL below.</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Dev Server URL</label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                  placeholder="http://localhost:3000"
                />
              </div>
            </>
          )}

          {testResult && (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 text-sm font-semibold ${
                testResult.status === 'completed' ? 'text-green-600 dark:text-green-400' :
                testResult.status === 'chrome-not-connected' ? 'text-amber-600 dark:text-amber-400' :
                'text-red-600 dark:text-red-400'
              }`}>
                {testResult.status === 'completed' ? <CheckCircle2 size={16} /> : <X size={16} />}
                {testResult.status === 'completed' ? 'Test Complete' :
                 testResult.status === 'chrome-not-connected' ? 'Chrome Not Connected' : 'Test Failed'}
              </div>

              {testResult.summary && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{testResult.summary}</p>
              )}

              {testResult.criteria.length > 0 && (
                <div className="space-y-1">
                  {testResult.criteria.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                        c.status === 'passed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                        c.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                        'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}>
                        {c.status.toUpperCase()}
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-300 truncate">{c.criterion}</span>
                    </div>
                  ))}
                </div>
              )}

              {testResult.reportPath && (
                <p className="text-[10px] text-zinc-400">
                  Full report: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{testResult.reportPath}</code>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          {testResult ? (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
              >
                Close
              </button>
              <button
                onClick={() => onRunTest(serverUrl)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition"
              >
                Re-run Test
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => onRunTest(serverUrl)}
                disabled={isRunning || !serverUrl.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition disabled:opacity-50"
              >
                {isRunning ? (
                  <><span className="animate-spin">⟳</span> Running...</>
                ) : (
                  <><Globe size={12} /> Run Browser Test</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChromeExtensionGuideModal;

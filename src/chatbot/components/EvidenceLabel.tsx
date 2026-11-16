'use client';

import React from 'react';
import { getEvidenceLabel, getEvidenceColor, type EvidenceType } from '../domain/EvidenceParser';

type Props = {
  type: EvidenceType;
};

export const EvidenceBadge: React.FC<Props> = ({ type }) => {
  const label = getEvidenceLabel(type);
  const colorClass = getEvidenceColor(type);
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${colorClass}`}>
      {label}
    </span>
  );
};

export default EvidenceBadge;

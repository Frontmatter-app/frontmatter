import React from 'react';
import {
  BookOpen,
  FileText,
  LayoutGrid,
  LifeBuoy,
  Network,
  Presentation,
  Frame,
  Tag,
} from 'lucide-react';
import { PUBLISH_TYPES, PUBLISH_TYPE_INFO, type PublishType } from './publishTypes';

const TYPE_ICON: Record<PublishType, React.ComponentType<{ className?: string }>> = {
  docs: FileText,
  blog: LayoutGrid,
  book: BookOpen,
  slide: Presentation,
  wiki: Network,
  portfolio: Frame,
  changelog: Tag,
  kb: LifeBuoy,
};

interface StepTypeProps {
  selected: PublishType;
  onSelect: (type: PublishType) => void;
}

/** Step one: what kind of site this workspace becomes. */
export function StepType({ selected, onSelect }: StepTypeProps) {
  return (
    <div className="type-grid" role="radiogroup" aria-label="Publish as">
      {PUBLISH_TYPES.map((type) => {
        const Icon = TYPE_ICON[type];
        const info = PUBLISH_TYPE_INFO[type];
        const isSelected = selected === type;

        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className="type-card"
            data-selected={isSelected}
            onClick={() => onSelect(type)}
          >
            <span className="type-card__icon">
              <Icon className="w-4 h-4" />
            </span>
            <span className="type-card__title">{info.title}</span>
            <span className="type-card__description">{info.description}</span>
          </button>
        );
      })}
    </div>
  );
}

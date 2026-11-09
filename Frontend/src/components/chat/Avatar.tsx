import { useState } from 'react';
import { initials } from './format';

interface AvatarProps {
  name: string;
  src?: string | null;
  // Shows the presence dot (with its text for screen readers); leave out for
  // people whose presence is not shown
  online?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = { sm: 'h-8 w-8 text-[11px]', md: 'h-10 w-10 text-xs', lg: 'h-11 w-11 text-sm' } as const;

// A photo, or the person's initials when there is none (or it does not load)
export default function Avatar({ name, src, online, size = 'md' }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div className="relative shrink-0">
      <div
        className={`flex items-center justify-center overflow-hidden rounded-full bg-emerald-100 font-semibold text-emerald-700 ${SIZES[size]}`}
      >
        {showImage ? (
          <img
            src={src as string}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailedSrc(src as string)}
          />
        ) : (
          <span aria-hidden="true">{initials(name) || '?'}</span>
        )}
      </div>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
            online ? 'bg-emerald-500' : 'bg-slate-300'
          }`}
        >
          <span className="sr-only">{online ? 'online' : 'offline'}</span>
        </span>
      )}
    </div>
  );
}

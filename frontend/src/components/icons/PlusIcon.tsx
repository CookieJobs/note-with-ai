import React from 'react';

interface PlusIconProps {
  size?: number;
  className?: string;
  title?: string;
  strokeWidth?: number;
}

const PlusIcon: React.FC<PlusIconProps> = ({ size = 16, className, title = '新建', strokeWidth = 2 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
};

export default PlusIcon;
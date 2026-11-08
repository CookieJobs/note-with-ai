/** Shared decorative brand mark; adjacent text supplies the brand's accessible name. */
type BrandIconProps = {
  size?: number;
  className?: string;
};

export default function BrandIcon({ size = 29, className }: BrandIconProps) {
  return (
    <img
      src="/brand/notewithai.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={className}
      draggable={false}
      style={{ display: 'block', maxWidth: '100%', height: 'auto', aspectRatio: '1', objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

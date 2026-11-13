const PATHS = {
  alert: (
    <>
      <path d="M10 3.5 2.8 16h14.4L10 3.5Z" />
      <path d="M10 8.5v3.5M10 14.2v.1" />
    </>
  ),
  external: (
    <>
      <path d="M11.5 3.5h5v5" />
      <path d="M16.5 3.5 9 11" />
      <path d="M14.5 11.5v4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h4" />
    </>
  ),
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="m12.75 12.75 3.75 3.75" />
    </>
  ),
  close: <path d="m6 6 8 8M14 6l-8 8" />,
  chevronLeft: <path d="M12 4.5 6.5 10l5.5 5.5" />,
  chevronRight: <path d="M8 4.5 13.5 10 8 15.5" />,
  translate: (
    <>
      <path d="M3 4.5h8M7 3v1.5c0 3-1.8 5.6-4 6.5" />
      <path d="M5 7.5c.8 1.6 2.3 2.8 4 3.3" />
      <path d="m10 17 3.25-7.5L16.5 17M11.1 14.5h4.3" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 11.5 5 4.5h10l2 7v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4Z" />
      <path d="M3 11.5h4l1 2h4l1-2h4" />
    </>
  ),
  log: (
    <>
      <path d="M5 3.5h10v13H5z" />
      <path d="M7.75 7h4.5M7.75 10h4.5M7.75 13h2.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

type IconProps = {
  name: IconName;
  className?: string;
  label?: string;
};

export default function Icon({ name, className = "icon", label }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

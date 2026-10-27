import Image from "next/image";

/** Brand mark. Decorative: it is always shown next to the "RackFlow AI" name.
 *  The source artwork is dark ink on transparent; dark mode inverts it to light. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      priority
      unoptimized
      className="shrink-0 dark:invert"
    />
  );
}

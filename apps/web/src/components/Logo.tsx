/** Brand mark. Decorative: it is always shown next to the "RackFlow AI" name.
 *  The artwork is one ink on transparent, so it is drawn as a mask filled with the `text`
 *  token: it follows both modes without inverting a raster image. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={
        "inline-block shrink-0 bg-text [mask-image:url(/logo.png)] [mask-position:center] " +
        "[mask-repeat:no-repeat] [mask-size:contain] forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none"
      }
      style={{ width: size, height: size }}
    />
  );
}

/**
 * What an act will do, said before it is done: warm when it takes something
 * away, calm when it only gives. The Catalogue's sheets and the owner's
 * Add-on sheets say it the same way.
 */
export const EffectBox = ({ tone, title, lines }: { tone: "takes" | "gives"; title: string; lines: readonly string[] }) => (
  <div className={`effect-box ${tone}`} role="status">
    <strong>{title}</strong>
    <ul>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  </div>
);

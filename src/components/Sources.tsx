import { fmtDate } from "@/lib/format";
import type { Pack } from "@/lib/pack/schema";

export function SourceList({ pack, ids }: { pack: Pack; ids: string[] }) {
  const sources = ids.flatMap((id) => pack.sources.find((s) => s.id === id) ?? []);
  if (sources.length === 0) return null;
  return (
    <ul className="sources">
      {sources.map((s) => (
        <li key={s.id}>
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.title}
          </a>
          <span className="sources__meta">
            {" "}
            {s.publisher}, retrieved {fmtDate(s.retrievedOn)}
            {s.pageDate ? `, page dated ${fmtDate(s.pageDate)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

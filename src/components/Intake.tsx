"use client";

import type { InputDef, Pack, Profile } from "@/lib/pack/schema";

const OPTION_LABEL: Record<string, string> = {
  national_visa: "On a national study visa",
  visa_free: "Without a visa",
  unsure: "I am not sure",
};

type Props = {
  pack: Pack;
  profile: Profile;
  onChange: (next: Profile) => void;
};

export function IntakeFields({ pack, profile, onChange }: Props) {
  const set = (id: string, value: string | boolean | undefined) => {
    const inputs = { ...profile.inputs };
    if (value === undefined || value === "" || value === false) delete inputs[id];
    else inputs[id] = value;
    onChange({ ...profile, inputs });
  };

  return (
    <div className="fields">
      {pack.inputs.map((def) => (
        <Field key={def.id} def={def} value={profile.inputs[def.id]} onSet={(v) => set(def.id, v)} />
      ))}
    </div>
  );
}

function Field({
  def,
  value,
  onSet,
}: {
  def: InputDef;
  value: string | boolean | undefined;
  onSet: (v: string | boolean | undefined) => void;
}) {
  const id = `in-${def.id}`;
  const helpId = def.help ? `${id}-help` : undefined;

  if (def.type === "boolean") {
    return (
      <div className="field field--check">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onSet(e.target.checked)}
          aria-describedby={helpId}
        />
        <label htmlFor={id}>{def.label}</label>
        {def.help && (
          <p id={helpId} className="field__help">
            {def.help}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{def.label}</label>
      {def.type === "enum" ? (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onSet(e.target.value || undefined)}
          aria-describedby={helpId}
        >
          <option value="">Choose one</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {OPTION_LABEL[o] ?? o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          data-empty={typeof value === "string" && value ? undefined : ""}
          onChange={(e) => onSet(e.target.value || undefined)}
          aria-describedby={helpId}
        />
      )}
      {def.help && (
        <p id={helpId} className="field__help">
          {def.help}
        </p>
      )}
    </div>
  );
}

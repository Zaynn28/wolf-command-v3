"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AssignableStaff = {
  id: string;
  name: string;
  employeeCode: string;
  companyId: string;
  companyName: string;
  departmentName: string;
  positionTitle: string;
};

export function StaffAssignList({
  people,
  companyId,
  unavailable,
  selectedId,
  pending,
  onAssign,
}: {
  people: AssignableStaff[];
  companyId?: string;
  unavailable?: boolean;
  selectedId: string | null;
  pending: boolean;
  onAssign: (person: AssignableStaff) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const eligible = companyId ? people.filter((person) => person.companyId === companyId) : people;
  const showCompany = new Set(eligible.map((person) => person.companyId)).size > 1;
  const matches = eligible.filter((person) => {
    const name = person.name.toLowerCase();
    const code = person.employeeCode.toLowerCase();
    return name.includes(needle) || code.includes(needle);
  });

  if (unavailable) {
    return <p className="text-sm text-muted">HR employees could not be read for this company.</p>;
  }
  if (eligible.length === 0) {
    return <p className="text-sm text-muted">No HR employees are recorded for this company.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-muted">
        Search staff
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or employee code"
          className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground"
        />
      </label>
      {needle === "" ? null : matches.length === 0 ? (
        <p className="text-sm text-muted">No matching staff.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
          {matches.map((person) => {
            const selected = selectedId === person.id;
            return (
              <li key={`${person.companyId}-${person.id}`}>
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={selected}
                  onClick={() => onAssign(person)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm disabled:opacity-50 sm:grid-cols-[minmax(0,1.2fr)_5.5rem_minmax(0,1fr)] sm:items-center ${selected ? "bg-raised" : "bg-background hover:bg-raised"}`}
                >
                  <span className="truncate font-medium text-foreground">{person.name}</span>
                  <span className="text-muted">{person.employeeCode}</span>
                  <span className="col-span-2 truncate text-muted sm:col-span-1">{person.departmentName === "No department" ? "—" : person.departmentName}</span>
                  {showCompany ? <span className="col-span-2 text-muted sm:col-span-3">{person.companyName}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ReassignTask({
  taskId,
  companyId,
  assigneePersonId,
  people,
  unavailable,
}: {
  taskId: string;
  companyId: string;
  assigneePersonId: string | null;
  people: AssignableStaff[];
  unavailable?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function assign(person: AssignableStaff) {
    if (person.id === assigneePersonId) return;
    setPending(true);
    setError("");
    const response = await fetch(`/api/organization/tasks/${taskId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reassign", assigneePersonId: person.id, teamDepartmentId: null, note: "Reassigned." }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The task was not reassigned.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <StaffAssignList
        people={people}
        companyId={companyId}
        unavailable={unavailable}
        selectedId={assigneePersonId}
        pending={pending}
        onAssign={(person) => void assign(person)}
      />
      {error ? <p className="mt-2 text-sm text-muted">{error}</p> : null}
    </div>
  );
}

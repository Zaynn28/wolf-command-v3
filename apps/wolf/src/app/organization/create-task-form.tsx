"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PersonOption = { id: string; label: string; companyId: string; departmentId: string };

export function CreateTaskForm({ people }: { people: PersonOption[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    const assignee = String(formData.get("assignee") ?? "");
    const person = people.find((item) => item.id === assignee);
    const response = await fetch("/api/organization/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: person?.companyId ?? "",
        departmentId: person?.departmentId ?? null,
        assigneePersonId: person?.id ?? null,
        teamDepartmentId: null,
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        dueOn: formData.get("dueOn"),
        completionCriteria: formData.get("completionCriteria"),
        reviewRequired: formData.get("reviewRequired") === "on",
      }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The task was not created.");
      return;
    }
    router.refresh();
  }

  if (people.length === 0) return null;
  return (
    <form action={submit} className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-2">
      <h2 className="md:col-span-2 text-sm font-semibold">Assign a demo task</h2>
      <label className="text-sm text-muted">
        Person
        <select name="assignee" className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground" required>
          {people.map((person) => (
            <option key={`${person.companyId}-${person.id}`} value={person.id}>{person.label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm text-muted">
        Priority
        <select name="priority" className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground" defaultValue="normal">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="text-sm text-muted md:col-span-2">
        Title
        <input name="title" required className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm" />
      </label>
      <label className="text-sm text-muted md:col-span-2">
        Description
        <textarea name="description" required rows={2} className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm" />
      </label>
      <label className="text-sm text-muted">
        Due
        <input type="date" name="dueOn" required className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm" />
      </label>
      <label className="text-sm text-muted">
        Completion criteria
        <input name="completionCriteria" required className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm" />
      </label>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="reviewRequired" />
        Reviewer approval is required
      </label>
      <button type="submit" disabled={pending} className="w-fit rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium disabled:opacity-50">
        {pending ? "Assigning…" : "Assign task"}
      </button>
      {error ? <p className="text-sm text-muted md:col-span-2">{error}</p> : null}
    </form>
  );
}

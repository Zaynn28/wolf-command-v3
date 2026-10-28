"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { StaffAssignList, type AssignableStaff } from "./staff-assign-list";

export function CreateTaskForm({ people }: { people: AssignableStaff[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [assignedId, setAssignedId] = useState<string | null>(null);

  async function assign(person: AssignableStaff) {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const dueOn = String(formData.get("dueOn") ?? "").trim();
    const criteria = String(formData.get("completionCriteria") ?? "").trim();
    if (!title || !description || !dueOn || !criteria) {
      setError("Fill in the task, then choose a person.");
      return;
    }
    setPendingId(person.id);
    setError("");
    const response = await fetch("/api/organization/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: person.companyId,
        departmentId: null,
        assigneePersonId: person.id,
        teamDepartmentId: null,
        title,
        description,
        priority: formData.get("priority"),
        dueOn,
        completionCriteria: criteria,
        reviewRequired: formData.get("reviewRequired") === "on",
      }),
    });
    setPendingId(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The task was not created.");
      return;
    }
    setAssignedId(person.id);
    form.reset();
    router.refresh();
  }

  if (people.length === 0) return null;
  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="grid gap-3 md:grid-cols-2">
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
      <div className="md:col-span-2">
        <StaffAssignList people={people} selectedId={assignedId} pending={pendingId !== null} onAssign={(person) => void assign(person)} />
      </div>
      {error ? <p className="text-sm text-muted md:col-span-2">{error}</p> : null}
    </form>
  );
}

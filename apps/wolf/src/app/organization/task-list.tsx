"use client";

import { useEffect, useState } from "react";
import type { TaskAction } from "@/server/organization/transitions";
import { ReassignTask, type AssignableStaff } from "./staff-assign-list";
import { TaskControls } from "./task-controls";

export type TaskListItem = {
  id: string;
  title: string;
  companyId: string;
  companyName: string;
  status: string;
  assigneeName: string | null;
  assigneePersonId: string | null;
  dueOn: string;
  overdue: boolean;
  allowedActions: TaskAction[];
  canAssign: boolean;
  directoryUnavailable: boolean;
};

const columns = "lg:grid-cols-[minmax(0,1.4fr)_4.5rem_7.5rem_minmax(0,1fr)_6.25rem]";

export function TaskList({ tasks, people }: { tasks: TaskListItem[]; people: AssignableStaff[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const openFromHash = () => {
      const hash = window.location.hash;
      const id = hash.startsWith("#task-") ? hash.slice("#task-".length) : "";
      setOpenId(id && tasks.some((task) => task.id === id) ? id : null);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [tasks]);

  if (tasks.length === 0) {
    return <p className="text-sm text-muted">No tasks in this view.</p>;
  }

  return (
    <div className="max-w-5xl overflow-x-auto rounded-lg border border-line bg-surface">
      <div className={`hidden border-b border-line px-4 py-2 text-xs font-medium text-muted lg:grid ${columns} lg:gap-x-3`}>
        <span>Task</span>
        <span>Company</span>
        <span>Status</span>
        <span>Assignee</span>
        <span>Due</span>
      </div>
      <ul className="divide-y divide-line">
        {tasks.map((task) => {
          const open = openId === task.id;
          const assignee = task.assigneeName ?? "Unassigned";
          return (
            <li key={task.id} id={`task-${task.id}`} className="scroll-mt-4">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : task.id)}
                className={`flex w-full flex-col gap-1 px-4 py-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:grid lg:items-center lg:gap-x-3 lg:py-2.5 ${columns} ${open ? "bg-raised" : "hover:bg-background"}`}
              >
                <span className="min-w-0 truncate font-medium text-foreground">{task.title}</span>
                <span className="flex flex-wrap gap-x-3 lg:contents">
                  <span className="text-muted">{task.companyName}</span>
                  <span className="font-medium whitespace-nowrap text-foreground">{task.status}</span>
                  <span className="min-w-0 truncate text-muted" title={assignee}>{assignee}</span>
                  <span className={`whitespace-nowrap ${task.overdue ? "text-accent" : "text-muted"}`}>{task.dueOn}</span>
                </span>
              </button>
              {open ? (
                <div className="border-t border-line px-4 py-3">
                  {task.canAssign ? (
                    <ReassignTask
                      taskId={task.id}
                      companyId={task.companyId}
                      assigneePersonId={task.assigneePersonId}
                      unavailable={task.directoryUnavailable}
                      people={people.filter((person) => person.companyId === task.companyId)}
                    />
                  ) : null}
                  <TaskControls taskId={task.id} actions={task.allowedActions} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

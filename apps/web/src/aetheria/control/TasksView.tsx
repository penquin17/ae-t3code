// The task list view (C7): exactly the Backend's published list. `null` is "nothing published yet", an unreadable view is unavailable (never an empty list), `stale` is an earlier Backend
// run's list not yet confirmed, and `unknown` is a contradiction the Backend cannot resolve: a client shows these as such and never as a current list.
import { useId } from "react";

import { Heading, cardClass, mutedClass } from "./parts";
import type { ReadView } from "./reads";
import type { TaskView } from "./types";

const STATUS_TEXT = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
} as const;

export function TasksView({ view }: { readonly view: ReadView<TaskView | null> }) {
  const headingId = useId();
  let body: React.ReactNode;
  let marker: string;
  if (view.state !== "known") {
    marker = view.state;
    body = (
      <p className="text-sm">
        {view.state === "unknown"
          ? "The task list has not been read yet"
          : "The task list is unavailable"}{" "}
        ({view.reason}).
      </p>
    );
  } else if (view.value === null) {
    marker = "none";
    body = <p className="text-sm">Nothing has been published yet.</p>;
  } else {
    const tasks = view.value;
    marker = tasks.state;
    body = (
      <>
        {tasks.state === "stale" ? (
          <p role="status" className="text-sm text-warning-foreground">
            This list is from an earlier Backend run. No new publication has confirmed it, so it may
            be out of date.
          </p>
        ) : null}
        {tasks.state === "unknown" ? (
          <p role="status" className="text-sm text-warning-foreground">
            The Backend saw contradicting publications and cannot say which list is this session's,
            so no list is shown.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.todos.length === 0 ? (
              <li className="text-sm">The published list is empty.</li>
            ) : null}
            {tasks.todos.map((todo) => (
              <li
                key={todo.content}
                data-todo-status={todo.status}
                className="flex min-w-0 gap-2 text-sm"
              >
                <span className={`${mutedClass} shrink-0`}>{STATUS_TEXT[todo.status]}</span>
                <span className="min-w-0 break-words">{todo.content}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={mutedClass}>Published {tasks.publishedAt}</p>
      </>
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      data-card="tasks"
      data-tasks={marker}
      className={cardClass}
    >
      <Heading id={headingId}>Tasks</Heading>
      {view.state === "known" && view.stale ? (
        <p className={mutedClass}>Last read is out of date ({view.reason}).</p>
      ) : null}
      {body}
    </section>
  );
}

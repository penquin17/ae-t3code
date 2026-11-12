import { ChevronRightIcon, EllipsisIcon, PinIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { cn } from "../../lib/utils";
import { foldKey, readFolds, resolveOpen, writeFolds, type Folds } from "./folds";
import { ageText, rowStatusText } from "./rowText";
import type { SessionActions } from "./useSessionActions";
import type { TreeGroup, TreeModel, TreeProject, TreeRow, TreeSection } from "./types";

const SECTION_TITLES: Record<TreeSection["id"], string> = {
  "needs-you": "Needs you",
  working: "Working",
  ongoing: "Ongoing",
  dormant: "Dormant",
};

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Fold state kept in the page, saved to browser storage when it works. */
function useFolds() {
  const [folds, setFolds] = useState<Folds>(() => {
    const storage = browserStorage();
    return storage === null ? {} : readFolds(storage).folds;
  });
  const toggle = (key: string, currentlyOpen: boolean) => {
    // Read the stored record again so entries this view does not consult are kept on write.
    const storage = browserStorage();
    const stored = storage === null ? {} : readFolds(storage).folds;
    const next = { ...stored, ...folds, [key]: !currentlyOpen };
    setFolds(next);
    if (storage !== null) writeFolds(storage, next);
  };
  return { folds, toggle };
}

function FoldHeading(props: {
  readonly label: string;
  readonly count?: number | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly level: "project" | "section";
  readonly trailing?: ReactNode;
  readonly badge?: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-1 pr-1", props.level === "project" ? "mt-2" : "")}>
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className={cn(
          "flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          props.level === "project" ? "text-sm font-medium text-sidebar-foreground" : "text-xs",
        )}
      >
        <ChevronRightIcon
          className={cn("size-3.5 shrink-0 transition-transform", props.open && "rotate-90")}
          aria-hidden
        />
        <span className="truncate">{props.label}</span>
        {props.count === undefined ? null : (
          <span className="shrink-0 tabular-nums">{props.count}</span>
        )}
        {props.badge}
      </button>
      {props.trailing}
    </div>
  );
}

function SessionRow(props: {
  readonly row: TreeRow;
  readonly now: number;
  readonly actions: SessionActions;
  readonly onResult: (
    label: string,
    run: Promise<import("../core/outcome").RunResult<unknown>>,
  ) => void;
  readonly renaming: boolean;
  readonly setRenaming: (id: string | null) => void;
}) {
  const { row, actions } = props;
  const [draft, setDraft] = useState(row.title);
  const detail = [rowStatusText(row), ageText(row.updatedAt, props.now)];
  if (row.folderState === "unavailable") detail.push("folder unavailable");
  else if (row.folder !== undefined) detail.push(row.folder);
  const commitRename = () => {
    const title = draft.trim();
    props.setRenaming(null);
    if (title === "" || title === row.title) return;
    props.onResult("Rename", actions.rename(row.id, title));
  };

  return (
    <li className="group/row flex items-center gap-1 pr-1">
      {props.renaming ? (
        <Input
          aria-label={`Rename ${row.title}`}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") props.setRenaming(null);
          }}
          className="mx-2 my-1"
        />
      ) : (
        <button
          type="button"
          data-session-row=""
          aria-current={row.current ? "page" : undefined}
          onClick={() => actions.open(row.id)}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md px-2 py-1 text-left hover:bg-sidebar-row-hover",
            row.current && "bg-accent",
          )}
        >
          <span className="flex items-center gap-1 text-sm text-sidebar-foreground">
            {row.pinned ? <PinIcon className="size-3 shrink-0" aria-label="Pinned" /> : null}
            <span className="truncate">{row.title}</span>
          </span>
          <span
            className={cn(
              "truncate text-xs",
              // Muted text on the open row's fill measures 3.9:1 in light mode (M10a contrast test).
              row.current ? "text-sidebar-foreground" : "text-sidebar-muted-foreground",
            )}
          >
            {detail.join(" · ")}
            {row.group === undefined ? "" : ` · in ${row.group.label}`}
          </span>
        </button>
      )}
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label={`Actions for ${row.title}`}
            />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            onClick={() =>
              props.onResult(row.pinned ? "Unpin" : "Pin", actions.pin(row.id, !row.pinned))
            }
          >
            {row.pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setDraft(row.title);
              props.setRenaming(row.id);
            }}
          >
            Rename
          </MenuItem>
          <MenuItem onClick={() => props.onResult("Fork", actions.fork(row.id))}>Fork</MenuItem>
          <MenuItem onClick={() => props.onResult("Archive", actions.archive(row.id))}>
            Archive
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

function GroupBlock(props: {
  readonly project: TreeProject;
  readonly group: TreeGroup;
  readonly folds: Folds;
  readonly toggle: (key: string, open: boolean) => void;
  readonly renderRow: (row: TreeRow) => ReactNode;
}) {
  const key = foldKey.group(props.project.id, props.group.key);
  const open = resolveOpen(props.folds, key, false, props.group.forcedOpen);
  return (
    <li>
      <FoldHeading
        level="section"
        label={props.group.label}
        count={props.group.count}
        open={open}
        onToggle={() => props.toggle(key, open)}
      />
      {open ? <ul className="ml-4">{props.group.members.map(props.renderRow)}</ul> : null}
    </li>
  );
}

/**
 * The project tree: projects, then Pinned, the state sections and Groups. It draws the model it is
 * given and edits nothing; every action goes through `actions` and ends as one of five outcomes.
 */
export function AetheriaSessionTree(props: {
  readonly model: TreeModel;
  readonly now: number;
  readonly actions: SessionActions;
  readonly onResult: (
    label: string,
    run: Promise<import("../core/outcome").RunResult<unknown>>,
  ) => void;
}) {
  const { model, now, actions } = props;
  const { folds, toggle } = useFolds();
  const [renamingId, setRenamingId] = useState<string | null>(null);

  if (model.projects.length === 0) {
    return <p className="px-3 py-4 text-sm text-sidebar-muted-foreground">No sessions yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1 pb-3" data-aetheria="sessions">
      {model.projects.map((project) => {
        const projectKey = foldKey.project(project.id);
        const projectOpen = resolveOpen(folds, projectKey, project.current, project.forcedOpen);
        const renderRow = (row: TreeRow) => (
          <SessionRow
            key={row.id}
            row={row}
            now={now}
            actions={actions}
            onResult={props.onResult}
            renaming={renamingId === row.id}
            setRenaming={setRenamingId}
          />
        );
        return (
          <section key={project.id} aria-label={project.title}>
            <FoldHeading
              level="project"
              label={project.title}
              open={projectOpen}
              onToggle={() => toggle(projectKey, projectOpen)}
              badge={
                <>
                  {project.needsYou > 0 ? (
                    <span className="shrink-0 rounded-full bg-accent px-1.5 text-xs tabular-nums">
                      {project.needsYou} need{project.needsYou === 1 ? "s" : ""} you
                    </span>
                  ) : null}
                  {project.working ? (
                    <span className="shrink-0 text-xs text-sidebar-muted-foreground">working</span>
                  ) : !project.workingKnown ? (
                    <span className="shrink-0 text-xs text-sidebar-muted-foreground">
                      state unknown
                    </span>
                  ) : null}
                </>
              }
              trailing={
                project.workspaceId === undefined ? null : (
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`New session in ${project.title}`}
                    onClick={() =>
                      props.onResult(
                        "New session",
                        actions.startSession(project.workspaceId as string),
                      )
                    }
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                )
              }
            />
            {projectOpen ? (
              <div className="ml-2">
                {project.pinned.length > 0 ? (
                  <PinnedBlock
                    project={project}
                    folds={folds}
                    toggle={toggle}
                    renderRow={renderRow}
                  />
                ) : null}
                {project.sections.map((section) => {
                  const key = foldKey.section(project.id, section.id);
                  const open = resolveOpen(folds, key, true, section.forcedOpen);
                  return (
                    <div key={section.id}>
                      <FoldHeading
                        level="section"
                        label={SECTION_TITLES[section.id]}
                        count={section.count}
                        open={open}
                        onToggle={() => toggle(key, open)}
                      />
                      {open ? <ul>{section.rows.map(renderRow)}</ul> : null}
                    </div>
                  );
                })}
                {project.groupsSection === undefined ? null : (
                  <GroupsBlock
                    project={project}
                    folds={folds}
                    toggle={toggle}
                    renderRow={renderRow}
                  />
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function PinnedBlock(props: {
  readonly project: TreeProject;
  readonly folds: Folds;
  readonly toggle: (key: string, open: boolean) => void;
  readonly renderRow: (row: TreeRow) => ReactNode;
}) {
  const key = foldKey.pinned(props.project.id);
  // The Pinned section defaults closed; a search that shows a pinned row draws it open without saving.
  const open = resolveOpen(props.folds, key, false, props.project.pinnedForcedOpen);
  return (
    <div>
      <FoldHeading
        level="section"
        label="Pinned"
        count={props.project.pinned.length}
        open={open}
        onToggle={() => props.toggle(key, open)}
      />
      {open ? <ul>{props.project.pinned.map(props.renderRow)}</ul> : null}
    </div>
  );
}

function GroupsBlock(props: {
  readonly project: TreeProject;
  readonly folds: Folds;
  readonly toggle: (key: string, open: boolean) => void;
  readonly renderRow: (row: TreeRow) => ReactNode;
}) {
  const section = props.project.groupsSection;
  if (section === undefined) return null;
  const key = foldKey.groups(props.project.id);
  const open = resolveOpen(props.folds, key, true, section.forcedOpen);
  return (
    <div>
      <FoldHeading
        level="section"
        label="Groups"
        count={section.count}
        open={open}
        onToggle={() => props.toggle(key, open)}
      />
      {open ? (
        <ul>
          {section.groups.map((group) => (
            <GroupBlock
              key={group.key}
              project={props.project}
              group={group}
              folds={props.folds}
              toggle={props.toggle}
              renderRow={props.renderRow}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  EllipsisIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { cn } from "../../lib/utils";
import type { GroupsHandle } from "../groups/useGroups";
import { controlRouteParams } from "./controlLink";
import { foldKey, readFolds, resolveOpen, writeFolds, type Folds } from "./folds";
import {
  GroupRenameDialog,
  SuggestionItem,
  type RenameTarget,
  type ResultSink,
} from "./GroupControls";
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

interface RowEditing {
  readonly kind: "rename" | "fork";
  readonly id: string;
}
interface GroupPartner {
  readonly id: string;
  readonly title: string;
}

function SessionRow(props: {
  readonly row: TreeRow;
  readonly now: number;
  readonly actions: SessionActions;
  readonly onResult: ResultSink;
  readonly editing: RowEditing | null;
  readonly setEditing: (editing: RowEditing | null) => void;
  /** Sessions this one is confirmed grouped with, among those shown. */
  readonly partners: readonly GroupPartner[];
  readonly groups: GroupsHandle;
}) {
  const { row, actions } = props;
  const control = controlRouteParams(row.id);
  const [draft, setDraft] = useState(row.title);
  const detail = [rowStatusText(row), ageText(row.updatedAt, props.now)];
  if (row.folderState === "unavailable") detail.push("folder unavailable");
  else if (row.folder !== undefined) detail.push(row.folder);
  const editing = props.editing?.id === row.id ? props.editing.kind : null;
  const commit = () => {
    const title = draft.trim();
    props.setEditing(null);
    if (editing === "fork") {
      if (title !== "") props.onResult("Fork as", actions.forkAndRename(row.id, title));
      return;
    }
    if (title === "" || title === row.title) return;
    props.onResult("Rename", actions.rename(row.id, title));
  };
  const startEditing = (kind: RowEditing["kind"]) => {
    setDraft(kind === "rename" ? row.title : `${row.title} fork`);
    props.setEditing({ kind, id: row.id });
  };

  return (
    <li className="group/row">
      <div className="flex items-center gap-1 pr-1">
        {editing !== null ? (
          <Input
            aria-label={
              editing === "fork" ? `Title for the fork of ${row.title}` : `Rename ${row.title}`
            }
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={editing === "fork" ? () => props.setEditing(null) : commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") props.setEditing(null);
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
            {control === null ? null : (
              <MenuItem
                render={
                  <Link
                    to="/aetheria/control/$environmentId/$threadId"
                    params={control}
                    aria-label={`Open human control for ${row.title}`}
                  />
                }
              >
                Open human control
              </MenuItem>
            )}
            {control === null ? null : (
              <MenuItem
                render={
                  <Link
                    to="/aetheria/deliverables/$environmentId/$threadId"
                    params={control}
                    aria-label={`Deliverables for ${row.title}`}
                  />
                }
              >
                Deliverables
              </MenuItem>
            )}
            <MenuItem
              onClick={() =>
                props.onResult(row.pinned ? "Unpin" : "Pin", actions.pin(row.id, !row.pinned))
              }
            >
              {row.pinned ? "Unpin" : "Pin"}
            </MenuItem>
            <MenuItem onClick={() => startEditing("rename")}>Rename</MenuItem>
            <MenuItem onClick={() => props.onResult("Fork", actions.fork(row.id))}>Fork</MenuItem>
            <MenuItem onClick={() => startEditing("fork")}>Fork as…</MenuItem>
            {props.partners.map((partner) => (
              <MenuItem
                key={partner.id}
                onClick={() =>
                  props.onResult("Ungroup", props.groups.store.ungroup(row.id, partner.id))
                }
              >
                Ungroup from {partner.title}
              </MenuItem>
            ))}
            {row.grouped ? (
              <MenuItem onClick={() => props.onResult("Detach", props.groups.store.detach(row.id))}>
                Detach from group
              </MenuItem>
            ) : null}
            <MenuItem onClick={() => props.onResult("Archive", actions.archive(row.id))}>
              Archive
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {control !== null && row.state === "needs-you" ? (
        // Prominent on a row that waits for the person: the human-control cards are where they answer.
        <Link
          to="/aetheria/control/$environmentId/$threadId"
          params={control}
          aria-label={`Open human control for ${row.title}`}
          className="mx-2 mb-1 flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-2 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-row-hover"
        >
          <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Open human control</span>
        </Link>
      ) : null}
    </li>
  );
}

function GroupBlock(props: {
  readonly project: TreeProject;
  readonly group: TreeGroup;
  readonly folds: Folds;
  readonly toggle: (key: string, open: boolean) => void;
  readonly renderRow: (row: TreeRow) => ReactNode;
  readonly onRename: (group: TreeGroup) => void;
  readonly canRename: boolean;
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
        trailing={
          props.canRename ? (
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label={`Rename group ${props.group.label}`}
              onClick={() => props.onRename(props.group)}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          ) : null
        }
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
  readonly groups: GroupsHandle;
  readonly onResult: ResultSink;
}) {
  const { model, now, actions, groups } = props;
  const { folds, toggle } = useFolds();
  const [editing, setEditing] = useState<RowEditing | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const confirmed = groups.state.record.state === "known" ? groups.state.record.value : undefined;
  const titles = titlesOf(model);
  const partnersOf = (id: string): GroupPartner[] =>
    (confirmed?.links ?? []).flatMap((link) => {
      const other = link.a === id ? link.b : link.b === id ? link.a : undefined;
      const title = other === undefined ? undefined : titles.get(other);
      return other === undefined || title === undefined ? [] : [{ id: other, title }];
    });

  if (model.projects.length === 0) {
    return <p className="px-3 py-4 text-sm text-sidebar-muted-foreground">No sessions yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1 pb-3" data-aetheria="sessions">
      {renameTarget === null ? null : (
        <GroupRenameDialog
          key={renameTarget.key}
          target={renameTarget}
          rename={groups.store.rename}
          onResult={props.onResult}
          onClose={() => setRenameTarget(null)}
        />
      )}
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
            editing={editing}
            setEditing={setEditing}
            partners={partnersOf(row.id)}
            groups={groups}
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
                    groups={groups}
                    onResult={props.onResult}
                    onRename={(group) =>
                      setRenameTarget({
                        key: group.key,
                        offered: group.label,
                        component: group.component,
                      })
                    }
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

/** Every row the model shows, by id, so a pair's other end can be named in a menu. */
function titlesOf(model: TreeModel): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  for (const project of model.projects) {
    const rows = [
      ...project.pinned,
      ...project.sections.flatMap((section) => section.rows),
      ...(project.groupsSection?.groups.flatMap((group) => group.members) ?? []),
    ];
    for (const row of rows) titles.set(row.id, row.title);
  }
  return titles;
}

function GroupsBlock(props: {
  readonly project: TreeProject;
  readonly folds: Folds;
  readonly toggle: (key: string, open: boolean) => void;
  readonly renderRow: (row: TreeRow) => ReactNode;
  readonly groups: GroupsHandle;
  readonly onResult: ResultSink;
  readonly onRename: (group: TreeGroup) => void;
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
          {section.suggestions.map((suggestion) => (
            <SuggestionItem
              key={`${suggestion.a.id}|${suggestion.b.id}`}
              suggestion={suggestion}
              onGroup={() =>
                props.onResult("Group", props.groups.store.group(suggestion.a.id, suggestion.b.id))
              }
              onDismiss={() =>
                props.onResult(
                  "Dismiss suggestion",
                  props.groups.store.dismiss(suggestion.a.id, suggestion.b.id),
                )
              }
            />
          ))}
          {section.groups.map((group) => (
            <GroupBlock
              key={group.key}
              project={props.project}
              group={group}
              folds={props.folds}
              toggle={props.toggle}
              renderRow={props.renderRow}
              onRename={props.onRename}
              canRename={props.groups.state.record.state === "known"}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

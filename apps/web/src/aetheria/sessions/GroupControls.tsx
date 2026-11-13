import { useRef, useState, type FormEvent } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import type { RunResult } from "../core/outcome";
import { RefusalNotice } from "../refusals/RefusalNotice";
import { outcomeText, refusalOf, type OutcomeNotice } from "./outcomeText";
import type { TreeSuggestion } from "./types";

export type ResultSink = (label: string, run: Promise<RunResult<unknown>>) => void;

/** The group a rename dialog was opened for: captured at open, so a later list change cannot retarget it. */
export interface RenameTarget {
  readonly key: string;
  /** The name the dialog offers: the saved name, else the newest member's title. */
  readonly offered: string;
  /** Every member of the full component, whatever a search shows. */
  readonly component: readonly string[];
}

/**
 * Renames the whole group, not only the members a search shows. The draft lives here and nowhere else, so a
 * newer list never replaces what is being typed. Submitting the offered name writes nothing; an empty name
 * clears the saved one. The dialog stays open, with the reason, until the Backend has confirmed the change.
 */
export function GroupRenameDialog(props: {
  readonly target: RenameTarget;
  readonly rename: (members: readonly string[], name: string) => Promise<RunResult<unknown>>;
  readonly onResult: ResultSink;
  readonly onClose: () => void;
}) {
  const { target, onClose } = props;
  const [draft, setDraft] = useState(target.offered);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    readonly notice: OutcomeNotice;
    readonly refusal: ReturnType<typeof refusalOf>;
  } | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (name === target.offered.trim()) {
      onClose();
      return;
    }
    setPending(true);
    setFailure(null);
    const run = props.rename(target.component, name);
    props.onResult("Rename group", run);
    void run.then((result) => {
      setPending(false);
      if (!result.current) return;
      if (result.outcome.kind === "confirmed") onClose();
      else {
        setFailure({
          notice: outcomeText("Rename group", result.outcome),
          refusal: refusalOf(result.outcome),
        });
      }
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup initialFocus={field} data-aetheria="rename-group">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
            <DialogDescription>
              Names all {target.component.length} sessions of this group, including any a search
              hides. Leave it empty to clear the saved name.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2">
              <Input
                ref={field}
                aria-label="Group name"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              {failure === null ? null : failure.refusal === undefined ? (
                <p
                  role="alert"
                  data-tone={failure.notice.tone}
                  className="text-sm text-destructive"
                >
                  {failure.notice.text}
                </p>
              ) : (
                <RefusalNotice
                  code={failure.refusal.code}
                  backendMessage={failure.refusal.message}
                />
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** One suggested pair: accept it as a group, or dismiss it so it is not offered again. */
export function SuggestionItem(props: {
  readonly suggestion: TreeSuggestion;
  readonly onGroup: () => void;
  readonly onDismiss: () => void;
}) {
  const { a, b } = props.suggestion;
  return (
    <li data-suggestion="" className="flex items-center gap-1 pr-1">
      <span className="min-w-0 flex-1 px-2 py-1 text-xs text-sidebar-muted-foreground">
        <span className="block truncate">
          Suggested: {a.title} + {b.title}
        </span>
      </span>
      <Button
        type="button"
        size="compact"
        variant="ghost-muted"
        aria-label={`Group ${a.title} and ${b.title}`}
        onClick={props.onGroup}
      >
        Group
      </Button>
      <Button
        type="button"
        size="compact"
        variant="ghost-muted"
        aria-label={`Dismiss the suggestion for ${a.title} and ${b.title}`}
        onClick={props.onDismiss}
      >
        Dismiss
      </Button>
    </li>
  );
}

"use client";

import { useState } from "react";
import { Plus, Save, Trash2, Users } from "lucide-react";
import {
  PURSUIT_CONTACT_ROLES,
  type PursuitContactRole,
} from "@/lib/pursuits/types";

export type PursuitContact = {
  id: string;
  role: PursuitContactRole;
  name: string | null;
  organization: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  url: string | null;
  notes: string | null;
  isPrimary: boolean;
};

type Draft = {
  role: PursuitContactRole;
  name: string;
  organization: string;
  email: string;
  phone: string;
  notes: string;
  isPrimary: boolean;
};

const emptyDraft: Draft = {
  role: "GOVERNMENT_POC",
  name: "",
  organization: "",
  email: "",
  phone: "",
  notes: "",
  isPrimary: false,
};

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}

export function ContactEditor({
  contacts,
  onCreate,
  onUpdate,
  onDelete,
}: {
  contacts: PursuitContact[];
  onCreate: (draft: Draft) => Promise<void>;
  onUpdate: (id: string, draft: Draft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function draftFromContact(contact: PursuitContact): Draft {
    return {
      role: contact.role,
      name: contact.name ?? "",
      organization: contact.organization ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      notes: contact.notes ?? "",
      isPrimary: contact.isPrimary,
    };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusyId("new");
    try {
      await onCreate(newDraft);
      setNewDraft(emptyDraft);
    } finally {
      setBusyId(null);
    }
  }

  async function save(id: string, draft: Draft) {
    setBusyId(id);
    try {
      await onUpdate(id, draft);
      setEditing((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await onDelete(id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <Users className="h-3.5 w-3.5 text-[var(--pursuit-brass)]" />
        Contacts
      </h3>
      <div className="space-y-2">
        {contacts.map((contact) => {
          const draft = editing[contact.id] ?? draftFromContact(contact);
          const isEditing = Boolean(editing[contact.id]);
          return (
            <div
              key={contact.id}
              className="border border-[var(--border)] bg-[var(--surface-alt)] p-3"
            >
              {isEditing ? (
                <ContactFields
                  draft={draft}
                  onChange={(next) =>
                    setEditing((prev) => ({ ...prev, [contact.id]: next }))
                  }
                />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {contact.name || contact.organization || "Unnamed contact"}
                      </div>
                      <div className="text-xs uppercase text-[var(--text-muted)]">
                        {label(contact.role)}
                        {contact.isPrimary ? " / Primary" : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing((prev) => ({
                          ...prev,
                          [contact.id]: draftFromContact(contact),
                        }))
                      }
                      className="text-xs font-semibold text-[var(--pursuit-brass)]"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-[var(--text-secondary)]">
                    <span>{contact.email || "No email"}</span>
                    <span>{contact.phone || "No phone"}</span>
                    <span className="col-span-2">
                      {contact.notes || "No notes"}
                    </span>
                  </div>
                </>
              )}
              <div className="mt-2 flex gap-2">
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => save(contact.id, draft)}
                    disabled={busyId === contact.id}
                    className="inline-flex items-center gap-1 border border-[var(--pursuit-brass-border)] bg-[var(--pursuit-brass-bg)] px-2 py-1 text-xs font-semibold text-[var(--pursuit-brass)] disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" />
                    Save
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(contact.id)}
                  disabled={busyId === contact.id}
                  className="inline-flex items-center gap-1 border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--urgent)] disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={create}
        className="mt-3 border border-dashed border-[var(--border)] p-3"
      >
        <ContactFields draft={newDraft} onChange={setNewDraft} />
        <button
          type="submit"
          disabled={busyId === "new"}
          className="mt-2 inline-flex items-center gap-1 border border-[var(--pursuit-brass-border)] bg-[var(--pursuit-brass-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--pursuit-brass)] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add contact
        </button>
      </form>
    </section>
  );
}

function ContactFields({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        value={draft.role}
        onChange={(e) =>
          onChange({ ...draft, role: e.target.value as PursuitContactRole })
        }
        className="col-span-2 border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
      >
        {PURSUIT_CONTACT_ROLES.map((role) => (
          <option key={role} value={role}>
            {label(role)}
          </option>
        ))}
      </select>
      <Input
        value={draft.name}
        onChange={(name) => onChange({ ...draft, name })}
        placeholder="Name"
      />
      <Input
        value={draft.organization}
        onChange={(organization) => onChange({ ...draft, organization })}
        placeholder="Organization"
      />
      <Input
        value={draft.email}
        onChange={(email) => onChange({ ...draft, email })}
        placeholder="Email"
      />
      <Input
        value={draft.phone}
        onChange={(phone) => onChange({ ...draft, phone })}
        placeholder="Phone"
      />
      <label className="col-span-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={draft.isPrimary}
          onChange={(e) => onChange({ ...draft, isPrimary: e.target.checked })}
          className="accent-[var(--pursuit-brass)]"
        />
        Primary contact
      </label>
      <textarea
        value={draft.notes}
        onChange={(e) => onChange({ ...draft, notes: e.target.value })}
        placeholder="Notes"
        className="col-span-2 min-h-16 border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
      />
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="min-w-0 border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
    />
  );
}

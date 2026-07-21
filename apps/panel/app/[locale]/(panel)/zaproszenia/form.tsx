"use client";

import { useActionState } from "react";

import { inviteMemberAction, type InviteMemberState } from "./actions";

const initialState: InviteMemberState = {};

export function InviteMemberForm({
  emailUnavailableReason,
}: {
  emailUnavailableReason?: string;
}) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {emailUnavailableReason ? (
        <p
          role="status"
          className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800"
        >
          Wysyłka e-maili jest niedostępna: {emailUnavailableReason} Zaproszenie utworzysz, ale link
          trzeba przekazać ręcznie.
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        E-mail zapraszanej osoby
        <input type="email" name="email" required className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Rola
        <select name="role" defaultValue="staff" className="rounded border px-3 py-2">
          <option value="staff">staff</option>
          <option value="owner">owner</option>
        </select>
      </label>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Wysyłam…" : "Wyślij zaproszenie"}
      </button>
    </form>
  );
}

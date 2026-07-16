"use client";

import { useState } from "react";

import { Link } from "@/i18n/navigation";

interface FaqItem {
  answer: string;
  linkLabel?: string;
  question: string;
}

export function toggleFaqItem(current: number | null, target: number): number | null {
  return current === target ? null : target;
}

export function FaqAccordion({ items }: { items: readonly FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item, index) => {
        const expanded = open === index;
        const trigger = `faq-trigger-${index}`;
        const panel = `faq-panel-${index}`;

        return (
          <article key={item.question}>
            <h3>
              <button
                aria-controls={panel}
                aria-expanded={expanded}
                className="flex min-h-16 w-full items-center justify-between gap-6 py-5 text-left text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
                id={trigger}
                onClick={() => setOpen((value) => toggleFaqItem(value, index))}
                type="button"
              >
                <span>{item.question}</span>
                <span aria-hidden="true" className="text-2xl font-normal">
                  {expanded ? "−" : "+"}
                </span>
              </button>
            </h3>
            <div
              aria-labelledby={trigger}
              className="max-w-3xl pb-6 pr-12 text-base leading-7 text-muted-foreground"
              hidden={!expanded}
              id={panel}
              role="region"
            >
              <p>
                {item.answer}
                {item.linkLabel ? (
                  <>
                    {" "}
                    <Link className="font-medium underline underline-offset-4" href="/privacy">
                      {item.linkLabel}
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

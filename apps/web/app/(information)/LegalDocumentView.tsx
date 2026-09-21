'use client';

/**
 * FRIGAT — shared renderer for the legal documents.
 *
 * /privacy, /terms and /refunds are the same page with different content, so
 * they share one renderer rather than three near-identical trees. Each route
 * keeps its own server shell for `metadata`, which may only be exported from a
 * server component — the same split /rules already uses.
 *
 * Reuses the .info__* classes from the (information) layout so these pages
 * inherit the reading measure, heading scale and section rhythm the other
 * information pages already have, instead of introducing a parallel set.
 */

import { useLanguage } from '@/components/providers/LanguageProvider';
import { LEGAL_DETAILS_INCOMPLETE, LEGAL_LAST_UPDATED } from '@/lib/legal';
import type { LocalisedDocument } from '@/lib/legalContent';

export function LegalDocumentView({ document }: { document: LocalisedDocument }) {
  const { locale, t } = useLanguage();
  // The document carries both locales; pick one. `locale` is 'en' | 'ru' and
  // both keys are required by LocalisedDocument, so there is no missing case.
  const doc = document[locale];

  return (
    <>
      <h1 className="info__title">{doc.title}</h1>
      <p className="info__lede">{doc.lede}</p>

      <p className="info__note">
        <b>{t('legal.updatedLabel')}</b>
        <span>{LEGAL_LAST_UPDATED}</span>
      </p>

      {/*
        Shown while lib/legal.ts still holds placeholder operator details.
        Deliberately visible to the reader rather than logged to a console: a
        document that names "[TO BE COMPLETED]" as the data controller must not
        be able to reach production looking finished. The flag is derived from
        the values, so filling them in removes this banner automatically.
      */}
      {LEGAL_DETAILS_INCOMPLETE && (
        <p className="info__note info__note--age">
          <b>{t('legal.draftLabel')}</b>
          <span>{t('legal.draftBody')}</span>
        </p>
      )}

      {doc.sections.map((section) => (
        <section className="info__section" id={section.id} key={section.id}>
          <h2>{section.heading}</h2>

          {section.paragraphs?.map((text) => (
            // Paragraph text is stable prose from a typed module, never user
            // input, so its own text is a safe and stable key.
            <p key={text}>{text}</p>
          ))}

          {section.bullets && (
            <ul className="info__list">
              {section.bullets.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}

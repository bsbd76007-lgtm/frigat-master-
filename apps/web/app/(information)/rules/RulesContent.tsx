'use client';

/**
 * FRIGAT — /rules, client half.
 *
 * Split out of page.tsx so the copy can go through `t()`. The locale lives in
 * React state on the client (LanguageProvider), so a server component cannot
 * read it — but `metadata` can only be exported from a server component. The
 * page is therefore a server shell that owns the metadata and renders this.
 * Same arrangement as admin/support -> SupportConsole.
 *
 * Section ids are load-bearing: the footer links to #terms, #fair, #age, #aml
 * and #game-rules directly, which is what let those columns stop pointing at
 * /legal/* routes that were never built. Keep them on the <section> elements.
 */

import Link from 'next/link';

import { useLanguage } from '@/components/providers/LanguageProvider';

export function RulesContent() {
  const { t } = useLanguage();

  return (
    <>
      <h1 className="info__title">{t('rules.title')}</h1>
      <p className="info__lede">{t('rules.lede')}</p>

      <p className="info__note">
        <b>{t('rules.draftLabel')}</b>
        <span>{t('rules.draftBody')}</span>
      </p>

      <section className="info__section" id="terms">
        <h2>{t('rules.termsTitle')}</h2>
        <p>{t('rules.termsBody')}</p>
        <h3>{t('rules.stakesTitle')}</h3>
        <ul className="info__list">
          <li>
            <b>{t('rules.stakesServerLead')}</b> {t('rules.stakesServerBody')}
          </li>
          <li>
            <b>{t('rules.stakesLedgerLead')}</b> {t('rules.stakesLedgerBody')}
          </li>
          <li>
            <b>{t('rules.stakesFinalLead')}</b> {t('rules.stakesFinalBody')}
          </li>
          <li>
            <b>{t('rules.stakesLimitsLead')}</b> {t('rules.stakesLimitsBody')}
          </li>
        </ul>
        <h3>{t('rules.suspensionTitle')}</h3>
        <p>{t('rules.suspensionBody')}</p>
      </section>

      <section className="info__section" id="fair">
        <h2>{t('rules.fairTitle')}</h2>
        <p>{t('rules.fairBody')}</p>
        <ul className="info__list">
          <li>
            <b>{t('rules.fairServerLead')}</b> {t('rules.fairServerBody')}
          </li>
          <li>
            <b>{t('rules.fairClientLead')}</b> {t('rules.fairClientBody')}
          </li>
          <li>
            <b>{t('rules.fairNonceLead')}</b> {t('rules.fairNonceBody')}
          </li>
          <li>
            <b>{t('rules.fairRevealLead')}</b> {t('rules.fairRevealBody')}
          </li>
        </ul>
        <p>{t('rules.fairNote')}</p>
      </section>

      <section className="info__section" id="age">
        <h2>{t('rules.ageTitle')}</h2>
        <p className="info__note info__note--age">
          <b>{t('rules.ageBadge')}</b>
          <span>{t('rules.ageBadgeBody')}</span>
        </p>
        <p>{t('rules.ageBody')}</p>
      </section>

      <section className="info__section" id="aml">
        <h2>{t('rules.amlTitle')}</h2>
        <p>{t('rules.amlBody')}</p>
        <ul className="info__list">
          <li>
            <b>{t('rules.amlSourceLead')}</b> {t('rules.amlSourceBody')}
          </li>
          <li>
            <b>{t('rules.amlIdentityLead')}</b> {t('rules.amlIdentityBody')}
          </li>
          <li>
            <b>{t('rules.amlRouteLead')}</b> {t('rules.amlRouteBody')}
          </li>
          <li>
            <b>{t('rules.amlPassLead')}</b> {t('rules.amlPassBody')}
          </li>
          <li>
            <b>{t('rules.amlReportLead')}</b> {t('rules.amlReportBody')}
          </li>
        </ul>
      </section>

      <section className="info__section" id="game-rules">
        <h2>{t('rules.gamesTitle')}</h2>
        <p>{t('rules.gamesBody')}</p>
        <ul className="info__list">
          <li>
            <b>{t('rules.gamesCrashLead')}</b> {t('rules.gamesCrashBody')}
          </li>
          <li>
            <b>{t('rules.gamesMinesLead')}</b> {t('rules.gamesMinesBody')}
          </li>
          <li>
            <b>{t('rules.gamesDiceLead')}</b> {t('rules.gamesDiceBody')}
          </li>
          <li>
            <b>{t('rules.gamesTableLead')}</b> {t('rules.gamesTableBody')}
          </li>
          <li>
            <b>{t('rules.gamesSlotsLead')}</b> {t('rules.gamesSlotsBody')}
          </li>
          <li>
            <b>{t('rules.gamesPracticeLead')}</b> {t('rules.gamesPracticeBody')}
          </li>
        </ul>
        <p>{t('rules.malfunction')}</p>
      </section>

      <p className="info__lede" style={{ marginTop: 24 }}>
        {t('rules.questions')} <Link href="/promotions">{t('rules.seePromotions')}</Link>{' '}
        {t('rules.orSupport')}
      </p>
    </>
  );
}

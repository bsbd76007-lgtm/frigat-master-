/**
 * FRIGAT — legal document content.
 *
 * Why these documents live here rather than in locales/*.json, which is where
 * every other string in the app lives:
 *
 *   - They are content, not interface chrome. A lawyer reviewing them needs to
 *     read each document end to end; scattered across 120 keys in a 750-line
 *     dictionary, that is not possible.
 *   - The `en` and `ru` halves are typed as the same shape, so a section that
 *     exists in one language and not the other is a compile error — the same
 *     guarantee `Messages = typeof en` gives the JSON dictionaries.
 *   - Replacing a document wholesale after legal review is one edit here.
 *
 * ── Accuracy ────────────────────────────────────────────────────────────
 * The privacy document describes what this codebase actually stores, read off
 * prisma/schema.prisma rather than copied from a template. Specifically: there
 * is no IP address column, no user-agent column and no advertising identifier
 * anywhere in the schema, so this policy does not claim to collect them. If a
 * future migration adds any, this file must be updated in the same change —
 * an over-broad privacy policy is a misrepresentation just as a too-narrow one
 * is a compliance gap.
 *
 * These are drafts describing live behaviour. They are not a substitute for
 * review by a lawyer qualified in the operator's licensing jurisdiction; the
 * banner rendered above each one says so to the reader.
 */

import { OPERATOR } from '@/lib/legal';

export interface LegalSection {
  /** Anchor id — footer and in-page navigation link to these. */
  id: string;
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
}

export interface LegalDocument {
  title: string;
  lede: string;
  sections: readonly LegalSection[];
}

/** Both locales must supply the same document shape. */
export type LocalisedDocument = { en: LegalDocument; ru: LegalDocument };

const CONTACT_EN = `Write to ${OPERATOR.supportEmail} for account and payment questions, or to ${OPERATOR.privacyEmail} for anything about your personal data.`;
const CONTACT_RU = `По вопросам аккаунта и платежей пишите на ${OPERATOR.supportEmail}, по вопросам персональных данных — на ${OPERATOR.privacyEmail}.`;

/* ══════════════════════════════════════════════════════════════════════
   Privacy policy
   ══════════════════════════════════════════════════════════════════════ */

export const PRIVACY_POLICY: LocalisedDocument = {
  en: {
    title: 'Privacy policy',
    lede: 'What we collect, why we hold it, how long we keep it, and what you can ask us to do with it.',
    sections: [
      {
        id: 'controller',
        heading: 'Who is responsible for your data',
        paragraphs: [
          `${OPERATOR.legalName} (trading as ${OPERATOR.tradingName}), registered in ${OPERATOR.jurisdiction} under number ${OPERATOR.registrationNumber}, is the data controller for the information described here.`,
          CONTACT_EN,
        ],
      },
      {
        id: 'collected',
        heading: 'What we collect',
        paragraphs: [
          'We collect only what an account needs in order to work. This list is the complete set of personal data stored in our database.',
        ],
        bullets: [
          'Email address — your login identifier and the address we send one-time codes to.',
          'Password — stored only as an Argon2 hash. We never hold the password itself and cannot recover it for you.',
          'Telegram ID — only if you link a Telegram account.',
          'Wallet addresses you submit for deposits and withdrawals.',
          'Transaction and balance history — every stake, win, deposit, withdrawal and bonus, held as an append-only ledger.',
          'Gameplay records — the game, stake, outcome and multiplier of each round you play.',
          'Provably fair seeds — the server seed, its hash, your client seed and the nonce for each round.',
          'Referral relationships — the code you signed up with and the codes you hand out.',
          'Support messages — anything you write to us through the in-app support chat.',
          'Account status — whether an account is frozen, and the reason recorded by staff.',
        ],
      },
      {
        id: 'not-collected',
        heading: 'What we do not collect',
        paragraphs: [
          'We do not store your IP address, your browser user-agent, your device identifiers, your location, or any advertising or cross-site tracking identifier. There is no such field in our database.',
          'We do not sell personal data, and we do not share it with advertisers or data brokers.',
        ],
      },
      {
        id: 'basis',
        heading: 'Why we are allowed to hold it',
        bullets: [
          'Performance of a contract — running your account, settling bets and processing payments. Without this data there is no account.',
          'Legal obligation — anti-money-laundering, financial record-keeping and age verification duties, where they apply to us.',
          'Legitimate interests — preventing fraud, abuse and multi-accounting, and keeping the platform secure. We balance this against your interests and use the minimum data that achieves it.',
          'Consent — optional analytics only, and only if you accept it in the cookie banner. You can withdraw consent at any time and nothing about your account changes.',
        ],
      },
      {
        id: 'cookies',
        heading: 'Cookies and local storage',
        paragraphs: [
          'We use as little browser storage as the site can function with.',
        ],
        bullets: [
          'Strictly necessary — a session cookie that keeps you signed in, and a session token in local storage. Without these you cannot stay logged in, so they are set without asking and cannot be turned off.',
          'Preferences — your chosen language and colour theme, kept in local storage on your own device. They never reach our servers.',
          'Analytics — set only after you accept them. If you decline, no analytics storage is written and no analytics script is loaded at all.',
        ],
      },
      {
        id: 'processors',
        heading: 'Third parties that see your data',
        paragraphs: [
          'We keep the list short and we do not embed anything we do not need.',
        ],
        bullets: [
          'Cloudflare Turnstile — the anti-bot check on the sign-in, registration and password-reset forms. Cloudflare receives your IP address and browser signals in order to tell a human from a script. We do not receive or store your IP from it.',
          'Our email provider — delivers one-time codes and account notices. It processes your email address for that purpose only.',
          'Our hosting and database provider — stores the data described above on our behalf under a processing agreement.',
        ],
      },
      {
        id: 'retention',
        heading: 'How long we keep it',
        paragraphs: [
          'Account and financial records are kept for as long as your account is open, and afterwards for the period our anti-money-laundering and accounting obligations require — commonly five years from the end of the relationship, but confirm the exact period for your jurisdiction.',
          'One-time codes expire within minutes and are deleted. Support conversations are kept while a dispute could still be raised.',
        ],
      },
      {
        id: 'rights',
        heading: 'Your rights',
        paragraphs: [
          'Depending on where you live, you can ask us to give you a copy of your data, correct it, delete it, restrict or object to how we use it, or send it to another provider in a portable form.',
          'Deletion has a limit worth stating plainly: we cannot erase financial records we are legally required to retain, and we cannot erase the seed and outcome history that makes past rounds independently verifiable — removing it would destroy the evidence that the games were fair.',
          `Write to ${OPERATOR.privacyEmail} and we will respond within one month. If you are not satisfied, you can complain to the data protection authority where you live.`,
        ],
      },
      {
        id: 'security',
        heading: 'How we protect it',
        bullets: [
          'Passwords are hashed with Argon2 and are never stored or logged in plain text.',
          'The whole site is served over HTTPS and instructs browsers never to connect over plain HTTP.',
          'Sessions are signed and versioned, so changing your password immediately invalidates every token issued before it.',
          'Administrative actions against an account are written to an audit log.',
        ],
      },
      {
        id: 'children',
        heading: 'Age',
        paragraphs: [
          `This service is not for anyone under ${OPERATOR.minimumAge}. We do not knowingly collect data from children, and an account found to belong to someone underage is closed and its data deleted except where we must retain records.`,
        ],
      },
      {
        id: 'changes',
        heading: 'Changes to this policy',
        paragraphs: [
          'If we change how we use your data we will update this page and change the date shown at the top. Material changes will also be announced in the product.',
        ],
      },
    ],
  },
  ru: {
    title: 'Политика конфиденциальности',
    lede: 'Какие данные мы собираем, зачем их храним, как долго и что вы можете попросить нас с ними сделать.',
    sections: [
      {
        id: 'controller',
        heading: 'Кто отвечает за ваши данные',
        paragraphs: [
          `${OPERATOR.legalName} (торговая марка ${OPERATOR.tradingName}), зарегистрированная в юрисдикции ${OPERATOR.jurisdiction} под номером ${OPERATOR.registrationNumber}, является оператором персональных данных, описанных здесь.`,
          CONTACT_RU,
        ],
      },
      {
        id: 'collected',
        heading: 'Что мы собираем',
        paragraphs: [
          'Мы собираем только то, без чего аккаунт не работает. Этот список — полный перечень персональных данных в нашей базе.',
        ],
        bullets: [
          'Адрес электронной почты — ваш логин и адрес для одноразовых кодов.',
          'Пароль — хранится только в виде хеша Argon2. Сам пароль мы не храним и восстановить его не можем.',
          'Telegram ID — только если вы привязали аккаунт Telegram.',
          'Адреса кошельков, которые вы указываете для пополнений и выводов.',
          'История операций и баланса — каждая ставка, выигрыш, пополнение, вывод и бонус в виде неизменяемого реестра.',
          'Записи игр — игра, ставка, результат и множитель каждого раунда.',
          'Данные честности — серверное зерно и его хеш, ваше клиентское зерно и nonce каждого раунда.',
          'Реферальные связи — код, по которому вы зарегистрировались, и коды, которые выдаёте вы.',
          'Сообщения в поддержку — всё, что вы пишете нам через встроенный чат.',
          'Статус аккаунта — заморожен ли он и указанная сотрудником причина.',
        ],
      },
      {
        id: 'not-collected',
        heading: 'Что мы не собираем',
        paragraphs: [
          'Мы не храним ваш IP-адрес, user-agent браузера, идентификаторы устройства, местоположение, а также рекламные и трекинговые идентификаторы. Таких полей в нашей базе нет.',
          'Мы не продаём персональные данные и не передаём их рекламным сетям и брокерам данных.',
        ],
      },
      {
        id: 'basis',
        heading: 'На каком основании мы их храним',
        bullets: [
          'Исполнение договора — работа аккаунта, расчёт ставок и обработка платежей. Без этих данных аккаунт невозможен.',
          'Требование закона — противодействие отмыванию денег, финансовая отчётность и проверка возраста там, где эти обязанности к нам применимы.',
          'Законный интерес — предотвращение мошенничества, злоупотреблений и мультиаккаунтинга, обеспечение безопасности платформы. Мы соотносим это с вашими интересами и используем минимально необходимый объём данных.',
          'Согласие — только необязательная аналитика и только если вы приняли её в баннере. Согласие можно отозвать в любой момент, на аккаунт это не влияет.',
        ],
      },
      {
        id: 'cookies',
        heading: 'Cookie и локальное хранилище',
        paragraphs: [
          'Мы используем настолько мало браузерного хранилища, насколько это возможно для работы сайта.',
        ],
        bullets: [
          'Строго необходимые — сессионная cookie, которая держит вас в аккаунте, и токен сессии в локальном хранилище. Без них вход не сохраняется, поэтому они устанавливаются без запроса и не отключаются.',
          'Настройки — выбранные язык и тема оформления, хранятся локально на вашем устройстве и на наши серверы не передаются.',
          'Аналитика — устанавливается только после вашего согласия. При отказе аналитическое хранилище не создаётся и скрипт аналитики вообще не загружается.',
        ],
      },
      {
        id: 'processors',
        heading: 'Третьи лица, которые видят ваши данные',
        paragraphs: [
          'Список короткий, и мы не встраиваем то, что нам не нужно.',
        ],
        bullets: [
          'Cloudflare Turnstile — антибот-проверка на формах входа, регистрации и восстановления пароля. Cloudflare получает ваш IP-адрес и сигналы браузера, чтобы отличить человека от скрипта. Мы ваш IP от него не получаем и не храним.',
          'Наш почтовый провайдер — доставляет одноразовые коды и уведомления. Обрабатывает ваш адрес почты только для этого.',
          'Наш хостинг- и дата-провайдер — хранит перечисленные данные по нашему поручению на условиях договора обработки.',
        ],
      },
      {
        id: 'retention',
        heading: 'Сколько мы их храним',
        paragraphs: [
          'Данные аккаунта и финансовые записи хранятся, пока аккаунт открыт, и далее в течение срока, который требуют наши обязанности по ПОД/ФТ и бухгалтерскому учёту — обычно пять лет с момента прекращения отношений, но точный срок нужно уточнить для вашей юрисдикции.',
          'Одноразовые коды истекают за минуты и удаляются. Переписка с поддержкой хранится, пока по ней ещё возможен спор.',
        ],
      },
      {
        id: 'rights',
        heading: 'Ваши права',
        paragraphs: [
          'В зависимости от страны проживания вы можете запросить копию своих данных, их исправление или удаление, ограничение или возражение против обработки, а также передачу другому провайдеру в машиночитаемом виде.',
          'У удаления есть предел, о котором стоит сказать прямо: мы не можем стереть финансовые записи, которые обязаны хранить по закону, и не можем стереть историю зерен и результатов, которая позволяет независимо проверить прошлые раунды — её удаление уничтожило бы доказательство честности игр.',
          `Напишите на ${OPERATOR.privacyEmail}, и мы ответим в течение месяца. Если ответ вас не устроит, вы вправе обратиться в надзорный орган по защите данных по месту жительства.`,
        ],
      },
      {
        id: 'security',
        heading: 'Как мы их защищаем',
        bullets: [
          'Пароли хешируются алгоритмом Argon2 и никогда не хранятся и не логируются в открытом виде.',
          'Весь сайт работает по HTTPS и указывает браузеру никогда не подключаться по обычному HTTP.',
          'Сессии подписаны и версионируются: смена пароля немедленно аннулирует все ранее выданные токены.',
          'Действия администраторов в отношении аккаунта записываются в журнал аудита.',
        ],
      },
      {
        id: 'children',
        heading: 'Возраст',
        paragraphs: [
          `Сервис не предназначен для лиц младше ${OPERATOR.minimumAge} лет. Мы сознательно не собираем данные детей; аккаунт, владелец которого оказался несовершеннолетним, закрывается, а его данные удаляются, кроме записей, которые мы обязаны сохранить.`,
        ],
      },
      {
        id: 'changes',
        heading: 'Изменения политики',
        paragraphs: [
          'Если мы изменим способ использования ваших данных, мы обновим эту страницу и дату вверху. О существенных изменениях мы сообщим и в самом продукте.',
        ],
      },
    ],
  },
};

/* ══════════════════════════════════════════════════════════════════════
   Terms and conditions
   ══════════════════════════════════════════════════════════════════════ */

export const TERMS_AND_CONDITIONS: LocalisedDocument = {
  en: {
    title: 'Terms and conditions',
    lede: 'The agreement between you and the operator when you hold an account and place a stake.',
    sections: [
      {
        id: 'who',
        heading: 'Who you are contracting with',
        paragraphs: [
          `These terms are between you and ${OPERATOR.legalName}, registered in ${OPERATOR.jurisdiction} under number ${OPERATOR.registrationNumber}. Opening an account means you accept them.`,
        ],
      },
      {
        id: 'eligibility',
        heading: 'Eligibility',
        bullets: [
          `You must be at least ${OPERATOR.minimumAge} years old.`,
          'You must be legally permitted to gamble where you are. Online gambling is restricted or prohibited in many places, and it is your responsibility to know the law that applies to you.',
          'One account per person. Additional accounts may be closed and their balances withheld pending review.',
          'You must use your own identity and your own funds.',
        ],
      },
      {
        id: 'account',
        heading: 'Your account',
        paragraphs: [
          'Keep your password and access to your email secure. Anything done through your account while it is signed in is treated as done by you.',
          'Tell us immediately if you believe someone else has access. Changing your password invalidates every existing session.',
        ],
      },
      {
        id: 'stakes',
        heading: 'Stakes and settlement',
        bullets: [
          'Every outcome is decided by the server from a committed seed before your browser draws anything. The interface animates a result; it never determines one.',
          'A stake is accepted when the server records it against your balance. An accepted stake is final and cannot be withdrawn.',
          'Balances are held to eight decimal places and all arithmetic is exact. Nothing is rounded into or out of your balance.',
          'If a round fails to settle because of a technical fault, the stake is returned. We do not pay out a result the engine never produced.',
        ],
      },
      {
        id: 'fairness',
        heading: 'Provable fairness',
        paragraphs: [
          'Each seed pair is published as a hash before use and revealed when the pair is rotated, so you can verify after the fact that the outcomes were fixed in advance and not chosen once your stake was known.',
          'The server seed for a pair still in use is never disclosed — revealing it would let anyone predict every remaining round on that pair.',
        ],
      },
      {
        id: 'errors',
        heading: 'Obvious errors',
        paragraphs: [
          'If a stake is accepted or a payout made at odds, limits or amounts that are clearly wrong through a technical or human error, we may correct the settlement to what it should have been. We will tell you when we do and explain the correction.',
        ],
      },
      {
        id: 'prohibited',
        heading: 'Conduct we do not allow',
        bullets: [
          'Automated play, scripts or bots.',
          'Exploiting a defect instead of reporting it.',
          'Collusion, multi-accounting or bonus abuse.',
          'Using the platform to launder money or to move the proceeds of crime.',
        ],
      },
      {
        id: 'suspension',
        heading: 'Suspension and closure',
        paragraphs: [
          'We may freeze an account while we investigate a breach of these terms or a legal obligation. A frozen account cannot place stakes or withdraw.',
          'We will tell you the reason unless the law prevents us. If an investigation finds nothing, the freeze is lifted and any withheld balance released.',
          'You can close your account at any time. Closing it does not remove records we are required to keep.',
        ],
      },
      {
        id: 'responsible',
        heading: 'Responsible play',
        paragraphs: [
          'Games of chance carry a house edge. Over time the expected result of play is a loss, and no strategy changes that. Stake only what you can afford to lose.',
          'If your play stops feeling like a choice, stop and seek support. We will close an account on request and will not solicit you to reopen it.',
        ],
      },
      {
        id: 'liability',
        heading: 'Liability',
        paragraphs: [
          'We provide the service as it is. We are responsible for correctly settling accepted stakes and for holding your balance accurately. We are not liable for losses arising from your own play, from your device or connection, or from circumstances outside our reasonable control.',
          'Nothing here limits liability that cannot be limited by law, including for fraud or death or personal injury caused by negligence.',
        ],
      },
      {
        id: 'law',
        heading: 'Governing law and disputes',
        paragraphs: [
          `These terms are governed by the law of ${OPERATOR.jurisdiction}, and its courts have jurisdiction over any dispute.`,
          `Raise a complaint with us first at ${OPERATOR.supportEmail}. We will acknowledge it and give you a reasoned answer.`,
        ],
      },
      {
        id: 'changes',
        heading: 'Changes to these terms',
        paragraphs: [
          'We may update these terms. The date at the top shows the last revision, and material changes will be announced before they take effect. Continuing to play after that means you accept them.',
        ],
      },
    ],
  },
  ru: {
    title: 'Условия использования',
    lede: 'Соглашение между вами и оператором, когда вы открываете аккаунт и делаете ставку.',
    sections: [
      {
        id: 'who',
        heading: 'С кем вы заключаете договор',
        paragraphs: [
          `Настоящие условия заключаются между вами и ${OPERATOR.legalName}, зарегистрированной в юрисдикции ${OPERATOR.jurisdiction} под номером ${OPERATOR.registrationNumber}. Открывая аккаунт, вы принимаете их.`,
        ],
      },
      {
        id: 'eligibility',
        heading: 'Кто может играть',
        bullets: [
          `Вам должно быть не менее ${OPERATOR.minimumAge} лет.`,
          'Вам должно быть законодательно разрешено играть там, где вы находитесь. Онлайн-гемблинг во многих странах ограничен или запрещён, и знать применимое к вам право — ваша обязанность.',
          'Один аккаунт на человека. Дополнительные аккаунты могут быть закрыты, а их балансы удержаны до окончания проверки.',
          'Вы должны использовать собственную личность и собственные средства.',
        ],
      },
      {
        id: 'account',
        heading: 'Ваш аккаунт',
        paragraphs: [
          'Храните пароль и доступ к почте в безопасности. Всё, что сделано через ваш аккаунт при активной сессии, считается сделанным вами.',
          'Немедленно сообщите нам, если считаете, что доступ получил кто-то ещё. Смена пароля аннулирует все действующие сессии.',
        ],
      },
      {
        id: 'stakes',
        heading: 'Ставки и расчёт',
        bullets: [
          'Каждый результат определяется сервером из зафиксированного зерна до того, как браузер что-либо нарисует. Интерфейс анимирует результат, но никогда его не определяет.',
          'Ставка принята в момент, когда сервер списал её с баланса. Принятая ставка окончательна и не отзывается.',
          'Балансы хранятся с точностью до восьми знаков после запятой, вся арифметика точная. Ничто не округляется в баланс или из него.',
          'Если раунд не рассчитался из-за технического сбоя, ставка возвращается. Мы не выплачиваем результат, которого движок не выдавал.',
        ],
      },
      {
        id: 'fairness',
        heading: 'Доказуемая честность',
        paragraphs: [
          'Каждая пара зерен публикуется в виде хеша до использования и раскрывается при её смене, поэтому вы можете задним числом проверить, что результаты были зафиксированы заранее, а не выбраны после того, как стала известна ваша ставка.',
          'Серверное зерно действующей пары не раскрывается: его раскрытие позволило бы предсказать все оставшиеся раунды на этой паре.',
        ],
      },
      {
        id: 'errors',
        heading: 'Очевидные ошибки',
        paragraphs: [
          'Если ставка принята или выплата произведена по коэффициентам, лимитам или суммам, явно неверным из-за технической или человеческой ошибки, мы можем скорректировать расчёт до того, каким он должен был быть. О любой такой коррекции мы сообщим и объясним её.',
        ],
      },
      {
        id: 'prohibited',
        heading: 'Что запрещено',
        bullets: [
          'Автоматизированная игра, скрипты и боты.',
          'Использование обнаруженного дефекта вместо сообщения о нём.',
          'Сговор, мультиаккаунтинг и злоупотребление бонусами.',
          'Использование платформы для отмывания денег или движения преступных доходов.',
        ],
      },
      {
        id: 'suspension',
        heading: 'Приостановка и закрытие',
        paragraphs: [
          'Мы можем заморозить аккаунт на время проверки нарушения этих условий или исполнения требования закона. Замороженный аккаунт не может делать ставки и выводить средства.',
          'Мы сообщим причину, если закон это позволяет. Если проверка ничего не выявит, заморозка снимается, а удержанный баланс освобождается.',
          'Вы можете закрыть аккаунт в любой момент. Закрытие не удаляет записи, которые мы обязаны хранить.',
        ],
      },
      {
        id: 'responsible',
        heading: 'Ответственная игра',
        paragraphs: [
          'В играх на удачу заложено преимущество заведения. На длинной дистанции ожидаемый результат игры — проигрыш, и никакая стратегия этого не меняет. Ставьте только то, что готовы потерять.',
          'Если игра перестала быть вашим свободным выбором — остановитесь и обратитесь за помощью. Мы закроем аккаунт по вашей просьбе и не будем предлагать открыть его снова.',
        ],
      },
      {
        id: 'liability',
        heading: 'Ответственность',
        paragraphs: [
          'Мы предоставляем сервис как есть. Мы отвечаем за корректный расчёт принятых ставок и за точность вашего баланса. Мы не отвечаем за убытки, возникшие из вашей собственной игры, из-за вашего устройства или соединения либо по обстоятельствам вне нашего разумного контроля.',
          'Ничто здесь не ограничивает ответственность, которая не может быть ограничена по закону, включая ответственность за мошенничество, а также за смерть или вред здоровью вследствие небрежности.',
        ],
      },
      {
        id: 'law',
        heading: 'Применимое право и споры',
        paragraphs: [
          `Настоящие условия регулируются правом юрисдикции ${OPERATOR.jurisdiction}, и её суды рассматривают любые споры.`,
          `Сначала направьте претензию нам на ${OPERATOR.supportEmail}. Мы подтвердим получение и дадим мотивированный ответ.`,
        ],
      },
      {
        id: 'changes',
        heading: 'Изменения условий',
        paragraphs: [
          'Мы можем обновлять эти условия. Дата вверху показывает последнюю редакцию; о существенных изменениях мы сообщим до их вступления в силу. Продолжение игры после этого означает согласие с ними.',
        ],
      },
    ],
  },
};

/* ══════════════════════════════════════════════════════════════════════
   Refund policy
   ══════════════════════════════════════════════════════════════════════ */

export const REFUND_POLICY: LocalisedDocument = {
  en: {
    title: 'Refund policy',
    lede: 'When money comes back, when it does not, and how to ask.',
    sections: [
      {
        id: 'principle',
        heading: 'The general rule',
        paragraphs: [
          'A settled bet is not refundable. Once the server has accepted a stake and produced an outcome, that outcome stands whether it went your way or not — this is what makes the result meaningful for everyone playing.',
          'The situations below are the exceptions, and they exist because in each one the bet was never properly placed or settled in the first place.',
        ],
      },
      {
        id: 'automatic',
        heading: 'Returned automatically',
        bullets: [
          'A round that fails to settle because of a technical fault. The stake goes back to your balance; no result is paid.',
          'A stake accepted while your account was frozen or otherwise not eligible to play.',
          'A duplicate charge caused by a fault on our side.',
        ],
      },
      {
        id: 'onrequest',
        heading: 'Considered on request',
        bullets: [
          'A deposit that has not been played. If your balance still holds the full unplayed amount, we will return it to its source, less any network fee actually incurred.',
          'A deposit sent to the wrong address or in the wrong asset, where recovery is technically possible. Sometimes it is not, and we will tell you honestly which case yours is.',
          'Play on an account that we determine was accessed by someone other than you.',
        ],
      },
      {
        id: 'not',
        heading: 'Not refundable',
        bullets: [
          'Losing bets, including a long run of them.',
          'A stake you say was placed by mistake, at the wrong amount, or that you regret.',
          'Bonus funds and winnings from them where the bonus terms were not met.',
          'Balances forfeited after a confirmed breach of the terms, such as multi-accounting or bot play.',
        ],
      },
      {
        id: 'chargebacks',
        heading: 'Chargebacks',
        paragraphs: [
          'Please raise a problem with us before going to your payment provider. A chargeback filed without contacting us first will normally result in the account being frozen while it is investigated, which slows down the resolution for you rather than speeding it up.',
        ],
      },
      {
        id: 'how',
        heading: 'How to request a refund',
        paragraphs: [
          `Write to ${OPERATOR.supportEmail} from the email address on the account, with the date, the amount, and the round or transaction reference if you have it.`,
          'We aim to acknowledge within two business days and to reach a decision within fourteen. If we say no, we will tell you why, and you can escalate under the complaints route in the terms.',
        ],
      },
    ],
  },
  ru: {
    title: 'Политика возвратов',
    lede: 'Когда деньги возвращаются, когда нет и как об этом попросить.',
    sections: [
      {
        id: 'principle',
        heading: 'Общее правило',
        paragraphs: [
          'Рассчитанная ставка возврату не подлежит. После того как сервер принял ставку и выдал результат, этот результат остаётся в силе независимо от того, в вашу пользу он или нет — именно это делает результат значимым для всех играющих.',
          'Перечисленные ниже случаи — исключения, и они существуют потому, что в каждом из них ставка на самом деле не была должным образом сделана или рассчитана.',
        ],
      },
      {
        id: 'automatic',
        heading: 'Возвращается автоматически',
        bullets: [
          'Раунд, не рассчитавшийся из-за технического сбоя. Ставка возвращается на баланс, результат не выплачивается.',
          'Ставка, принятая в момент, когда аккаунт был заморожен или иным образом не допущен к игре.',
          'Повторное списание из-за ошибки на нашей стороне.',
        ],
      },
      {
        id: 'onrequest',
        heading: 'Рассматривается по заявлению',
        bullets: [
          'Неотыгранное пополнение. Если на балансе сохраняется вся неотыгранная сумма, мы вернём её на источник за вычетом фактически понесённой сетевой комиссии.',
          'Пополнение, отправленное на неверный адрес или не в том активе, если возврат технически возможен. Иногда он невозможен, и мы честно скажем, какой это случай.',
          'Игра на аккаунте, доступ к которому, по нашему заключению, получил не его владелец.',
        ],
      },
      {
        id: 'not',
        heading: 'Возврату не подлежит',
        bullets: [
          'Проигранные ставки, в том числе длинная серия проигрышей.',
          'Ставка, о которой вы говорите, что сделали её по ошибке, не на ту сумму или о которой сожалеете.',
          'Бонусные средства и выигрыши с них, если условия бонуса не были выполнены.',
          'Балансы, удержанные после подтверждённого нарушения условий — например, мультиаккаунтинга или игры ботом.',
        ],
      },
      {
        id: 'chargebacks',
        heading: 'Чарджбэки',
        paragraphs: [
          'Пожалуйста, сначала обратитесь с проблемой к нам, а не в платёжный сервис. Чарджбэк, поданный без предварительного обращения, как правило приводит к заморозке аккаунта на время разбирательства, что замедляет решение вашего вопроса, а не ускоряет его.',
        ],
      },
      {
        id: 'how',
        heading: 'Как запросить возврат',
        paragraphs: [
          `Напишите на ${OPERATOR.supportEmail} с адреса почты, указанного в аккаунте, сообщив дату, сумму и, если он у вас есть, идентификатор раунда или транзакции.`,
          'Мы стремимся подтвердить обращение в течение двух рабочих дней и принять решение в течение четырнадцати. При отказе мы объясним причину, и вы сможете обжаловать его в порядке рассмотрения претензий из условий использования.',
        ],
      },
    ],
  },
};

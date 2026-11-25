import LegalPage, { H2, List, Mail, P } from './LegalPage.jsx';
import { Link } from '../router.jsx';
import { LEGAL } from './facts.js';

export default function PrivacyPage() {
  return (
    <LegalPage
      title='Privacy Policy'
      summary={
        <>
          <strong>The short version:</strong> students don’t need accounts and we don’t record calls. Live board work is
          temporary. Saved lesson plans, calendar appointments and invoices stay in the teacher’s account; these can
          include student names and billing contacts. Card details go to Stripe, not to us. We don’t sell personal
          information, show ads, or track you across other websites.
        </>
      }
    >
      <P>
        {LEGAL.service} ({LEGAL.site}) is run by {LEGAL.operator} (“we”, “us”). It’s a live lesson workspace for tutors
        and their students. This policy explains what information we handle, why, and the choices you have.
      </P>

      <H2 id='who'>Who this covers</H2>
      <List>
        <li>
          <strong>Tutors</strong>, who sign in with a Google account to run lessons.
        </li>
        <li>
          <strong>Students</strong>, who join a tutor’s lesson with a four-digit code. Students don’t create accounts.
        </li>
        <li>
          <strong>Parents, guardians and other invoice recipients</strong>, whose details a tutor enters for lesson billing
          or who pay a lesson invoice.
        </li>
      </List>

      <H2 id='collect'>What we collect</H2>
      <P>
        <strong>From tutors.</strong> When you sign in with Google, we receive your name, email address, profile picture
        and Google account ID. We keep a sign-in session for up to 30 days, with a cookie that keeps you signed in.
      </P>
      <P>
        <strong>Subscription billing.</strong> Payments are handled by Stripe. We don’t store full card numbers. We store
        your Stripe customer ID and your plan’s status, such as your trial and renewal dates.
      </P>
      <P>
        <strong>During lessons.</strong> What you do on the whiteboard (drawing, letter tiles, pictures the tutor adds, and
        where the pointing hands are) passes through our servers so both screens stay in step. It’s held in memory only
        while the lesson runs and is deleted shortly after the lesson ends. The tutor’s own browser keeps a copy of the
        current board pages in memory, so a lesson can carry on if our server restarts.
      </P>
      <P>
        <strong>Saved preparation.</strong> When a tutor saves a lesson, we store its activity order, selected materials,
        private teaching prompts and any review notes under that tutor’s account. Uploaded worksheet images are kept in
        private storage. The tutor can edit or delete this preparation. Saved plans do not automatically record student
        drawing, answers or calls. Private prompts and notes are not sent to the student.
      </P>
      <P>
        <strong>Calendar appointments.</strong> We store the student name a tutor enters, lesson dates and times, time zone,
        duration, any selected saved preparation, and repeat settings. For weekly lessons, we also store individual
        changes and cancellations. These records stay under the tutor’s account and are not shown on the student’s board.
      </P>
      <P>
        <strong>Lesson invoices.</strong> We store the sender and recipient details a tutor enters, optional contact and
        address information, student name, lesson descriptions, amounts, currency, dates and notes. We also keep invoice
        status and payment records, including manual entries and corrections, online payment references, credits, refunds
        and dispute status where applicable. A tutor can print an invoice or share its payment link; the recipient then
        sees the details included on that invoice. The app does not automatically email invoices or calendar reminders.
      </P>
      <P>
        <strong>Online lesson payments.</strong> When a tutor connects a payment account, we send their name and email to
        Stripe. Stripe collects additional verification and payout information through its own onboarding. We store the
        connected-account ID and setup status. When an online invoice is issued, we send Stripe the recipient’s contact
        details and the invoice information needed to collect payment. Stripe sends payment, refund and dispute updates
        back to us. The service operator can review payment-dispute information to manage those disputes.
      </P>
      <P>
        <strong>Video and audio.</strong> When someone starts video, the camera and microphone connect directly between the
        two browsers. When a direct connection isn’t possible, a relay server we operate passes the encrypted stream along.
        We don’t record, store or listen to calls.
      </P>
      <P>
        <strong>Students.</strong> The student joining flow does not ask for a name, email address or age. What a student
        does in a lesson, including video if it’s switched on, is shared with their tutor as it happens. Live student
        board work and calls are not retained after the lesson. Separately, a tutor may enter a student’s name in the
        calendar or an invoice, or include information in saved preparation and private review notes.
      </P>
      <P>
        <strong>Technical information.</strong> Like most websites, our servers see IP addresses and basic browser details.
        We use them to keep the service secure (for example, to stop someone guessing lesson codes) and they appear in
        server logs, which we keep for about 30 days. We store a short description of the browser with each sign-in
        session.
      </P>
      <P>
        <strong>Cookies.</strong> We use one essential cookie to keep tutors signed in. We don’t use advertising or analytics
        cookies. Google’s sign-in button may set its own cookies, under Google’s privacy policy.
      </P>

      <H2 id='use'>How we use it</H2>
      <List>
        <li>To run lessons and keep both screens in step.</li>
        <li>To sign tutors in and manage their trial and subscription.</li>
        <li>To save teaching preparation and manage the appointments and invoices a tutor creates.</li>
        <li>To connect lesson payments, keep payment records up to date, and handle refunds and payment disputes.</li>
        <li>To keep the service secure and prevent abuse.</li>
        <li>To answer you when you contact us.</li>
        <li>To meet legal obligations, such as keeping billing records.</li>
      </List>
      <P>
        We don’t sell or rent personal information, we don’t use it for advertising, and we don’t use lesson content to
        train AI models.
      </P>

      <H2 id='share'>Who we share it with</H2>
      <P>Only the service providers that help us run {LEGAL.service}, each bound to protect it:</P>
      <List>
        <li>
          <strong>Microsoft Azure</strong> hosts the website, its database and stored files, in the United States.
        </li>
        <li>
          <strong>Google</strong> provides sign-in.
        </li>
        <li>
          <strong>Stripe</strong> processes subscriptions and online lesson payments, provides payment-account onboarding,
          and handles payment, refund and dispute information. Its own handling of that information is described in the{' '}
          <a href='https://stripe.com/privacy' className='font-semibold text-violet-700 underline underline-offset-2'>Stripe Privacy Policy</a>.
        </li>
      </List>
      <P>
        We may also share information when the law requires it, to protect someone’s safety, or as part of a sale or merger
        of the business, in which case this policy would continue to apply.
      </P>

      <H2 id='children'>Children</H2>
      <P>
        {LEGAL.service} is for tutors, who must be adults. Students, who may be children, use it only in lessons their tutor
        sets up, without an account. Tutors may enter student names and other personal information in appointments,
        invoices, saved preparation and private review notes. These saved records are separate from temporary live board
        work. Tutors should include only the information needed for teaching, scheduling and billing.
      </P>
      <P>
        Tutors who teach children are responsible for having a parent’s or guardian’s permission for online lessons,
        including video, and for making sure they have the permission needed to provide a child’s information for saved
        preparation, scheduling and billing. Parents and guardians can contact us at <Mail /> with any question, or to ask
        us to correct or delete information.
      </P>

      <H2 id='keep'>How long we keep it</H2>
      <List>
        <li>Tutor accounts: until you ask us to delete yours.</li>
        <li>Sign-in sessions: 30 days, or until you log out.</li>
        <li>Subscription and online payment records at Stripe: Stripe keeps its own financial records under its privacy policy.</li>
        <li>Live board content: deleted shortly after the lesson ends.</li>
        <li>Saved lesson plans, worksheet images and private review notes: until the tutor deletes them or their account is deleted.</li>
        <li>Calendar records: until the tutor’s account is deleted. Cancelling an appointment removes it from the active calendar but retains its stored record.</li>
        <li>Invoice drafts: until the tutor deletes them or their account is deleted. Issued invoices and payment entries remain in the account; corrections keep the original entry.</li>
        <li>Server logs: about 30 days.</li>
      </List>
      <P>
        Before account deletion finishes, unpaid online invoices must be closed. A partly paid online invoice with a
        remaining balance needs to be resolved first. Completed account deletion removes the app’s saved preparation,
        calendar and invoice records. Limited payment-provider references and reconciliation records remain, with
        duplicate contact details and notes removed. Deleting an account does not automatically refund payments or delete
        the tutor’s Stripe account, and Stripe retains its own records.
      </P>

      <H2 id='rights'>Your choices and rights</H2>
      <P>
        You can ask to see, correct or delete the information we hold about you by emailing <Mail />. You can cancel your
        subscription at any time from Account and billing. You can also remove {LEGAL.service}’s access in your Google
        account settings. Depending on where you live, you may have further rights under local law; we honour these
        requests for everyone, wherever they live.
      </P>

      <H2 id='security'>Security</H2>
      <P>
        Everything is sent over encrypted connections (HTTPS). Sign-in tokens are stored only as one-way fingerprints, the
        sign-in cookie can’t be read by scripts on the page, and card details never touch our servers. No system is
        perfectly secure, but we work to protect your information and will tell you if a breach affects you.
      </P>

      <H2 id='changes'>Changes to this policy</H2>
      <P>
        If we change this policy, we’ll update the date at the top. For significant changes, we’ll let tutors know by email
        before they take effect.
      </P>

      <H2 id='contact'>Contact</H2>
      <P>
        Questions about privacy? Write to <Mail />. See also our <Link to='/terms' className='font-semibold text-violet-700 underline underline-offset-2'>Terms of Service</Link>.
      </P>
    </LegalPage>
  );
}

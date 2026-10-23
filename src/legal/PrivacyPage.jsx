import LegalPage, { H2, List, Mail, P } from './LegalPage.jsx';
import { Link } from '../router.jsx';
import { LEGAL } from './facts.js';

export default function PrivacyPage() {
  return (
    <LegalPage
      title='Privacy Policy'
      summary={
        <>
          <strong>The short version:</strong> we collect as little as we can. Students don’t have accounts. Lessons aren’t
          recorded, and what happens in a lesson isn’t kept after it ends. Card details go to Stripe, not to us. We don’t
          sell personal information, show ads, or track you across other websites.
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
      </List>

      <H2 id='collect'>What we collect</H2>
      <P>
        <strong>From tutors.</strong> When you sign in with Google, we receive your name, email address, profile picture
        and Google account ID. We keep a sign-in session for up to 30 days, with a cookie that keeps you signed in.
      </P>
      <P>
        <strong>Billing.</strong> Payments are handled by Stripe. We never see or store your full card number. We store
        your Stripe customer ID and your plan’s status, such as your trial and renewal dates.
      </P>
      <P>
        <strong>During lessons.</strong> What you do on the whiteboard (drawing, letter tiles, pictures the tutor adds, and
        where the pointing hands are) passes through our servers so both screens stay in step. It’s held in memory only
        while the lesson runs and is deleted shortly after the lesson ends. The tutor’s own browser keeps a copy of the
        current board, so a lesson can carry on if our server restarts.
      </P>
      <P>
        <strong>Video and audio.</strong> When someone starts video, the camera and microphone connect directly between the
        two browsers. When a direct connection isn’t possible, a relay server we operate passes the encrypted stream along.
        We don’t record, store or listen to calls.
      </P>
      <P>
        <strong>Students.</strong> We don’t ask students for their name, email address or age. What a student does in a
        lesson, including video if it’s switched on, is shared with their tutor as it happens and isn’t kept by us after the
        lesson.
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
          <strong>Stripe</strong> processes payments and subscriptions.
        </li>
      </List>
      <P>
        We may also share information when the law requires it, to protect someone’s safety, or as part of a sale or merger
        of the business, in which case this policy would continue to apply.
      </P>

      <H2 id='children'>Children</H2>
      <P>
        {LEGAL.service} is for tutors, who must be adults. Students, who may be children, use it only in lessons their tutor
        sets up, without an account. We don’t knowingly collect personal information from children beyond what a lesson
        needs as it happens, and we don’t keep it afterwards.
      </P>
      <P>
        Tutors who teach children are responsible for having a parent’s or guardian’s permission for online lessons,
        including video. Parents and guardians can contact us at <Mail /> with any question, or to ask us to delete
        information.
      </P>

      <H2 id='keep'>How long we keep it</H2>
      <List>
        <li>Tutor accounts: until you ask us to delete yours.</li>
        <li>Sign-in sessions: 30 days, or until you log out.</li>
        <li>Billing records: as long as the law requires. Stripe keeps its own records under its privacy policy.</li>
        <li>Lesson content: deleted shortly after the lesson ends.</li>
        <li>Server logs: about 30 days.</li>
      </List>

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

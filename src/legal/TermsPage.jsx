import LegalPage, { H2, List, Mail, P } from './LegalPage.jsx';
import { Link } from '../router.jsx';
import { LEGAL } from './facts.js';

export default function TermsPage() {
  return (
    <LegalPage
      title='Terms of Service'
      summary={
        <>
          <strong>The short version:</strong> tutors get a {LEGAL.trialDays}-day free trial with no card needed, then{' '}
          {LEGAL.price}/month, and can cancel anytime. Your lesson materials stay yours. Please use the service kindly and
          lawfully, and if you teach children, have their parent’s or guardian’s permission.
        </>
      }
    >
      <P>
        These terms are an agreement between you and {LEGAL.operator} (“we”, “us”), which runs {LEGAL.service} at{' '}
        {LEGAL.site}. By using {LEGAL.service}, you agree to them. If you use it for an organisation, you agree on its
        behalf.
      </P>

      <H2 id='service'>The service</H2>
      <P>
        {LEGAL.service} is a live lesson workspace for structured literacy tutoring: a shared whiteboard, video, letter
        tiles, picture cards, pointing hands and reading activities. Tutors sign in to run lessons; students join a
        tutor’s lesson with a code and don’t need an account.
      </P>

      <H2 id='accounts'>Tutor accounts</H2>
      <List>
        <li>You must be at least 18 to create a tutor account.</li>
        <li>You sign in with a Google account and are responsible for what happens under your account.</li>
        <li>Each account is for one tutor. Please don’t share it.</li>
      </List>

      <H2 id='students'>Students and your responsibilities as a tutor</H2>
      <P>
        You choose who joins your lessons and you’re responsible for how the service is used in them. If you teach
        anyone under 18, you’re responsible for having their parent’s or guardian’s permission for online lessons,
        including video, and for following any rules that apply to your teaching.
      </P>

      <H2 id='billing'>Free trial, subscription and cancelling</H2>
      <List>
        <li>
          New tutors get a {LEGAL.trialDays}-day free trial. No card is needed to start, and if you don’t add one, the trial
          simply ends and you’re never charged.
        </li>
        <li>
          After the trial, the Tutor plan costs {LEGAL.price} per month (plus any applicable tax), billed in advance through
          Stripe, and renews each month until you cancel.
        </li>
        <li>
          You can cancel anytime from Account and billing. You keep access until the end of the period you’ve paid for.
        </li>
        <li>Payments aren’t refunded for partial months, except where the law requires.</li>
        <li>If we change the price, we’ll email you at least 30 days before it applies to you.</li>
      </List>

      <H2 id='use'>Acceptable use</H2>
      <P>Please don’t use {LEGAL.service} to:</P>
      <List>
        <li>break the law, or harm, harass or endanger anyone, especially a child;</li>
        <li>share content you don’t have the right to share, or that’s offensive or inappropriate for a lesson;</li>
        <li>record a lesson or call without everyone’s permission where the law requires it;</li>
        <li>try to get around our security, overload the service, or access other people’s lessons or accounts;</li>
        <li>copy, resell or rebuild the service.</li>
      </List>
      <P>We may suspend access that breaks these rules, and will tell you why where we reasonably can.</P>

      <H2 id='content'>Your content</H2>
      <P>
        Pictures, worksheets and anything else you bring to a lesson stay yours. You give us permission to host, send and
        display them only to run your lessons. Lesson content isn’t kept after a lesson ends; see the{' '}
        <Link to='/privacy' className='font-semibold text-violet-700 underline underline-offset-2'>
          Privacy Policy
        </Link>
        .
      </P>

      <H2 id='ours'>Our content</H2>
      <P>
        The software, design, articulation cards, illustrations and activities such as Phoneme Pop belong to us or our
        licensors. You may use them within your lessons while you have access, but not copy or distribute them elsewhere.
      </P>

      <H2 id='availability'>Changes and availability</H2>
      <P>
        We’re always improving {LEGAL.service}, so features may change. We work to keep it reliable, but can’t promise it
        will always be available or free of errors, for example during maintenance.
      </P>

      <H2 id='ending'>Ending your use</H2>
      <P>
        You can stop using {LEGAL.service} at any time, and ask us to delete your account at <Mail />. We may close
        accounts that seriously or repeatedly break these terms.
      </P>

      <H2 id='disclaimer'>Disclaimers</H2>
      <P>
        {LEGAL.service} is a teaching tool. It isn’t a diagnosis, assessment or treatment for dyslexia or any other
        condition. It’s provided “as is”, without warranties of any kind, to the fullest extent the law allows.
      </P>

      <H2 id='liability'>Limits on liability</H2>
      <P>
        To the fullest extent the law allows, we aren’t liable for indirect, incidental or consequential losses, and our
        total liability for any claim is limited to what you paid us in the 12 months before it. Nothing in these terms
        limits rights you have that can’t be limited by law.
      </P>

      <H2 id='law'>Governing law</H2>
      <P>
        These terms are governed by the laws of the State of {LEGAL.state}, and disputes will be handled in the state or
        federal courts located in {LEGAL.state}, unless the law where you live says otherwise.
      </P>

      <H2 id='changes'>Changes to these terms</H2>
      <P>
        If we change these terms, we’ll update the date at the top. For significant changes, we’ll let tutors know by email
        before they take effect. Continuing to use {LEGAL.service} after that means you accept the new terms.
      </P>

      <H2 id='contact'>Contact</H2>
      <P>
        Questions about these terms? Write to <Mail />.
      </P>
    </LegalPage>
  );
}

import { ResumeWizard } from "~/app/_components/resume-wizard";

export default function Home() {
  const edenEnabled = Boolean(process.env.EDENAI_API_KEY);
  return <ResumeWizard edenEnabled={edenEnabled} />;
}

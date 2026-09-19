import Layout from '@theme/Layout';
import { Hero } from '../hero/Hero';
import { COPY } from '../hero/copy';

/** The hero (roadmap item 58): the site's index. */
export default function Home() {
	return (
		<Layout title="factorai" description="Agentic Development Environment (ADE) for the AI era">
			<Hero copy={COPY} />
		</Layout>
	);
}

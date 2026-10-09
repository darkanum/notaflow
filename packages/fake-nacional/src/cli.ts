import { startFakeNacional } from './startFakeNacional';

const port = Number(process.argv[2] ?? process.env.FAKE_NACIONAL_PORT ?? 4010);
const fake = await startFakeNacional({ port });
console.log(`Fake Sefin: ${fake.urls.sefin}`);
console.log(`Fake ADN:   ${fake.urls.adn}`);
console.log('Scenarios:  POST /__fake/next {"route":"issue","kind":"delay","ms":31000}');

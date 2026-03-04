import { FootballDataService } from '../api/football-service.js';

(async () => {
  const svc = new FootballDataService();
  const leagues = ['brasileirao_serie_a','campeonato_paranaense','premier_league'];
  for (const slug of leagues) {
    try {
      console.log('\n===', slug, '===');
      const events = await svc.getNextEventsBySlug(slug);
      console.log(`Found ${events.length} events for ${slug}`);
      if (events.length) console.log(events.slice(0,3));
    } catch (e) {
      console.error('Error for', slug, e.message || e);
    }
  }
})();

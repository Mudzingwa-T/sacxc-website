/**
 * buildData(db) — assembles a single `data` object from the SQLite database
 * in the shape the CICM-design templates consume. This keeps the CICM front-end
 * intact while every value comes from the better-sqlite3 backend + CMS.
 */
const ISO = {
  'Angola':'ao','Botswana':'bw','Comoros':'km','Democratic Republic of Congo':'cd','DR Congo':'cd',
  'Eswatini':'sz','Lesotho':'ls','Madagascar':'mg','Malawi':'mw','Mauritius':'mu','Mozambique':'mz',
  'Namibia':'na','Seychelles':'sc','South Africa':'za','Tanzania':'tz','Zambia':'zm','Zimbabwe':'zw'
};
const FLAGS = {
  'Angola':'🇦🇴','Botswana':'🇧🇼','Comoros':'🇰🇲','Democratic Republic of Congo':'🇨🇩','DR Congo':'🇨🇩',
  'Eswatini':'🇸🇿','Lesotho':'🇱🇸','Madagascar':'🇲🇬','Malawi':'🇲🇼','Mauritius':'🇲🇺','Mozambique':'🇲🇿',
  'Namibia':'🇳🇦','Seychelles':'🇸🇨','South Africa':'🇿🇦','Tanzania':'🇹🇿','Zambia':'🇿🇲','Zimbabwe':'🇿🇼'
};

function buildData(db) {
  const S = {};
  try { db.prepare('SELECT key, value FROM site_settings').all().forEach(r => { S[r.key] = r.value; }); } catch (e) {}

  const site = {
    name: S.site_name || 'SACXC',
    fullName: S.site_full_name || 'Southern Africa Customer Experience Council',
    tagline: S.site_tagline || 'One Region. One Standard. One Customer Experience.',
    description: S.site_description || '',
    mission: S.mission || '', vision: S.vision || '', about: S.about_text || '',
    email: S.email || 'secretariat@sacxc.org', phone: S.phone || '', whatsapp: S.whatsapp || '',
    address: S.address || '11 Koi Street, Peolwane, Gaborone, Botswana',
    facebook: S.facebook || '#', linkedin: S.linkedin || '#', twitter: S.twitter || '#', instagram: '#', youtube: '#',
    developerCredit: S.developer_name || 'Code Labs Alliance', developerUrl: S.developer_url || 'https://www.codelabsalliance.com',
    livechatGreeting: 'Hello! Ask me about membership, services, governance or how to get involved.',
    livechatEmail: S.email || 'secretariat@sacxc.org', livechatWhatsapp: S.whatsapp || ''
  };

  const slides = safe(db, "SELECT * FROM hero_slides WHERE active=1 ORDER BY sort_order ASC").map(s => ({
    title: s.title, accent: s.title_accent || '', subtitle: s.subtitle || '', badge: s.badge || '',
    image: s.image_url || '/images/hero-1.jpg',
    cta1: s.cta_text || '', cta1link: s.cta_link || '#',
    cta2: s.cta_secondary_text || '', cta2link: s.cta_secondary_link || '#'
  }));

  const services = safe(db, "SELECT * FROM benefits WHERE active=1 ORDER BY sort_order ASC").map(b => ({
    title: b.title, icon: b.icon || 'circle-check', description: b.description || ''
  }));

  const objectives = safe(db, "SELECT * FROM achievements WHERE active=1 ORDER BY sort_order ASC").map(a => ({
    title: a.title, description: a.description || ''
  }));

  const offices = safe(db, "SELECT * FROM branches WHERE active=1 ORDER BY sort_order ASC").map(b => ({
    country: b.name, iso: ISO[b.name] || '', code: (ISO[b.name]||'').toUpperCase(), region: b.region || '', note: b.description || ''
  }));

  const partners = safe(db, "SELECT * FROM partners WHERE active=1 ORDER BY sort_order ASC").map(p => ({
    name: p.name, type: p.type || '', description: p.description || '',
    highlights: (p.highlights || '').split('|').filter(Boolean)
  }));

  const news = safe(db, "SELECT * FROM news WHERE published=1 ORDER BY created_at DESC LIMIT 3");

  return {
    site,
    ticker: [
      { text: 'SACXC unites 6 CX associations and 15 professional training institutes across all 16 SADC Member States', link: '/our-members', active: true },
      { text: 'An affiliate member of ACXCO — the African Council of Customer Experience Organizations', link: '/acxco', active: true },
      { text: 'Now welcoming national CX associations and training institutes across the SADC region', link: '/membership', active: true }
    ],
    slides,
    stats: [
      { n: '6', label: 'CX Associations' }, { n: '15', label: 'Training Institutes' },
      { n: '16', label: 'SADC Member States' }, { n: '1', label: 'ACXCO Affiliation' }
    ],
    services,
    standards: [
      { abbr:'CXF', title:'Regional CX Competency Framework', tag:'Framework', icon:'sitemap', description:'A shared, SADC-wide definition of what professional Customer Experience practice looks like — developed with input from every member.' },
      { abbr:'ASP', title:'Accreditation Support Pathway', tag:'Programme', icon:'award', description:'A regionally coordinated accreditation framework for CX training and professional development, aligned with ACXCO.' },
      { abbr:'SoCX', title:'State of CX in SADC', tag:'Annual Research', icon:'chart-line', description:'Regional CX benchmarking research members use to advocate for CX investment and support course development.' },
      { abbr:'GPG', title:'Good-Practice Guidance', tag:'Guidance', icon:'book-open', description:'Practical, SADC-relevant guidance that translates the regional standard into day-to-day practice.' }
    ],
    whatWeDo: [
      'Coordinate SADC-wide CX standards and good-practice guidance',
      'Support a regional accreditation pathway aligned with ACXCO',
      'Produce the State of CX in SADC benchmarking research',
      'Represent the region\u2019s CX community to SADC institutions and ACXCO',
      'Build the institutional capacity of member associations and institutes',
      'Convene regional forums, General Meetings and a standing peer network'
    ],
    membershipCategories: [
      { count:'6', name:'CX Associations', who:'National and regional Customer Experience associations across SADC.', benefit:'Recognized as the SACXC representative for their country, with a direct line into ACXCO.' },
      { count:'15', name:'Training Institutes', who:'Professional training institutes delivering CX education and development.', benefit:'Access to a regionally coordinated accreditation-support pathway aligned with ACXCO.' },
      { count:'—', name:'Corporate & Partners', who:'Organizations and partners supporting the regional CX agenda.', benefit:'Engagement with the region\u2019s CX community, research and convening platforms.' }
    ],
    valueCase: [
      ['Regional Credibility, Continental Reach','Become the recognized SACXC representative for your country — with a direct line into ACXCO\u2019s continental structure.'],
      ['A Governance Voice','Participate in SACXC\u2019s governance, with representation designed to give smaller and larger markets a genuine voice.'],
      ['Coordinated Accreditation Support','A regionally coordinated accreditation framework aligned with ACXCO\u2019s continental pathway.'],
      ['Standards You Don\u2019t Write Alone','SACXC coordinates the technical work of developing regional CX standards with input from every member.'],
      ['Regional Research','The State of CX in SADC — benchmarking research to advocate for CX investment locally.'],
      ['Proximity to SADC Institutions','Headquartered in Gaborone alongside the SADC Secretariat — a practical channel into regional policy.'],
      ['A Bridge to the Continental Agenda','As an ACXCO affiliate, SACXC carries your priorities into the continental agenda.'],
      ['Capacity-Building Support','Mentorship, governance guidance and peer support for newer or smaller organizations.'],
      ['A Regional Peer Network','Direct access to counterparts leading CX bodies in the other SADC states.'],
      ['You Keep Your Independence','SACXC does not run your programmes, take over your governance, or compete for your members or revenue.']
    ],
    howToApply: [
      { step:1, title:'Get in Touch', description:'Contact the SACXC Secretariat in Gaborone expressing your organization\u2019s interest and its category.' },
      { step:2, title:'Review & Alignment', description:'The Secretariat reviews your organization against the relevant category and shares the current framework and next steps.' },
      { step:3, title:'Welcome & Representation', description:'On confirmation, your organization becomes the recognized SACXC representative for its country and category.' }
    ],
    values: [
      ['Regional Solidarity','SADC member states, regardless of size or market maturity, share equally in the Council\u2019s work.'],
      ['Professionalism','CX is advanced as a recognized discipline with defined competencies and ethics.'],
      ['Credibility','Standards, guidance and accreditation support are evidence-based and consistently applied.'],
      ['Subsidiarity','SACXC coordinates and convenes; member associations and institutes deliver programmes locally.'],
      ['Inclusivity','Every SADC member state has an equal institutional voice, from Seychelles to South Africa.'],
      ['Collaboration','Knowledge, research and capacity are shared freely across the region\u2019s member organizations.'],
      ['Integrity','Coordination, disputes and accreditation-support decisions are handled fairly and transparently.'],
      ['Impact','Our work should measurably raise CX standards and professional recognition across SADC.']
    ],
    objectives,
    offices,
    partners,
    news,
    governance: {
      principles: [
        'Member-governed structure: strategic direction is set by the membership, not imposed from above.',
        'Balanced representation for both membership categories — CX associations and training institutes.',
        'Geographic balance safeguards so no single SADC sub-region dominates decision-making.',
        'Regular General Meetings where members set direction, review standards and elect leadership.',
        'Transparent, cost-recovery-based fee structures for accreditation-support and coordination.',
        'A direct affiliation channel into ACXCO\u2019s continental governance and standards processes.'
      ],
      model: 'SACXC operates on a member-governed, one member organization / one vote basis within each membership category. Every SADC Member State has an equal institutional voice at the Council, regardless of the size of its market.'
    },
    acxco: {
      intro: 'SACXC is an affiliate member of the African Council of Customer Experience Organizations (ACXCO) — the continental body uniting Africa\u2019s national CX professional bodies under a shared standard, accreditation system and voice.',
      means: 'This affiliation means SADC\u2019s CX community is not building its standards in isolation from the rest of the continent, nor is it subordinated to a body that overrides regional independence.',
      points: [
        'Represents SADC members\u2019 interests and priorities within ACXCO\u2019s continental structures.',
        'Channels ACXCO\u2019s continental standards, accreditation framework and research into a SADC-relevant form.',
        'Gives SADC-based associations and institutes a practical route into continental recognition.',
        'Retains full independence over its own regional governance, priorities and member relationships.'
      ],
      link: 'https://acxco.org'
    }
  };
}

function safe(db, sql) { try { return db.prepare(sql).all() || []; } catch (e) { return []; } }
module.exports = { buildData };

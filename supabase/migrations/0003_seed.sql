-- SKILLSEARN — default configuration (safe to re-run)

insert into app_settings(key, value) values
  ('withdrawal', '{"mode":"weekly","weeklyDay":1,"monthlyDay":5,"windowDays":1,"minAmount":500,
                   "chargeBps":500,"processingEnabled":true,"manualPayoutConfirmation":true}'),
  ('upgrade',    '{"windowDays":30,"commissionable":false,"commissionBaseBps":10000}'),
  ('commission', '{"holdDays":0,"directRequiresActivePackage":true}'),
  ('registration','{"referralRequired":false}')
on conflict (key) do nothing;

insert into commission_rule_versions(generation_rates_bps, note)
select array[1500,1200,800], 'Initial rates from specification'
where not exists (select 1 from commission_rule_versions);

insert into packages(name, slug, level, price, direct_rate_bps, max_generations, description, features) values
  ('Gold', 'gold', 1, 2000, 4000, 1, 'Start your skills journey.',
   array['Gold courses','40% direct referral commission','Generation 1 income']),
  ('Platinum', 'platinum', 2, 4000, 4000, 2, 'More skills, deeper income.',
   array['Gold + Platinum courses','40% direct referral commission','Generation 1 & 2 income']),
  ('Diamond', 'diamond', 3, 6000, 4000, 3, 'Everything, all generations.',
   array['All courses','40% direct referral commission','Generation 1, 2 & 3 income'])
on conflict (slug) do nothing;

insert into courses(title, slug, description, min_package_level, is_published, sort) values
  ('Digital Marketing Foundations', 'digital-marketing-foundations',
   'SEO, social media and ads basics to grow any business online.', 1, true, 1),
  ('Spoken English & Communication', 'spoken-english-communication',
   'Build confidence in everyday and professional English.', 1, true, 2),
  ('Graphic Design with Canva', 'graphic-design-canva',
   'Design posts, banners and brand kits without prior experience.', 2, true, 3),
  ('Video Editing for Creators', 'video-editing-creators',
   'Edit reels and YouTube videos on mobile and desktop.', 2, true, 4),
  ('Freelancing & Personal Branding', 'freelancing-personal-branding',
   'Find clients, price your work and build an online presence.', 3, true, 5),
  ('Web Development Basics', 'web-development-basics',
   'HTML, CSS and JavaScript fundamentals to build your first site.', 3, true, 6)
on conflict (slug) do nothing;

insert into lessons(course_id, title, content, duration_minutes, sort, is_preview)
select c.id, l.title, l.content, l.mins, l.sort, l.sort = 1
  from courses c
  cross join lateral (values
    (1, 'Introduction',            'Welcome to ' || c.title || '. What you will learn and how to get the most out of this course.', 8),
    (2, 'Core concepts',           'The key ideas you need before practising.', 15),
    (3, 'Hands-on practice',       'Follow along step by step.', 25),
    (4, 'Project & next steps',    'Apply everything in a mini project.', 20)
  ) as l(sort, title, content, mins)
 where not exists (select 1 from lessons where course_id = c.id);

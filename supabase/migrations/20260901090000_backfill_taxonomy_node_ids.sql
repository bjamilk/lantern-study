-- Backfill marketplace_listings.category_specific_fields.taxonomyNodeId onto the
-- nine-department tree, and index the column the new browse filters on.
--
-- Buyers can now drill department -> category -> subcategory, and a group filters
-- on its descendant leaves. Both read this one field, which until now held ids
-- from the old two-department tree — every one of which is dead.
--
-- Two rules, and the second is the one that matters:
--
--   1. A legacy id whose replacement is a LEAF is rewritten. 41 of these.
--
--   2. Any other id is REMOVED, not rewritten to its group. Writing a group id
--      would hide the listing twice over: leaf browse matches only leaves, and
--      the "listings with no node yet" rule matches only NULL. Removing it says
--      the true thing — this listing is known to its coarse category and no
--      finer — so it keeps showing under Electronics, Textbooks and the like,
--      and stays out of Smartphones until someone files it there.
--
-- Idempotent: re-running rewrites nothing, because the ids it looks for are gone.

BEGIN;

-- 1. Deterministic rewrites: old leaf -> new leaf.
UPDATE marketplace_listings AS l
SET category_specific_fields =
      jsonb_set(COALESCE(l.category_specific_fields, '{}'::jsonb),
                '{taxonomyNodeId}', to_jsonb(m.new_id))
FROM (VALUES
  ('academic.materials.textbooks.course', 'study-materials.textbooks.course-textbook'),
  ('academic.materials.textbooks.solutions', 'study-materials.textbooks.solutions-manual'),
  ('academic.materials.textbooks.lab-manual', 'study-materials.textbooks.lab-manual-workbook'),
  ('academic.materials.notes.lecture', 'study-materials.notes-handouts.lecture-notes'),
  ('academic.materials.notes.tutorial', 'study-materials.notes-handouts.tutorial-handouts'),
  ('academic.materials.assessments.printed-pq', 'study-materials.past-questions.printed-past-questions'),
  ('academic.materials.assessments.digital-bank', 'study-materials.lantern-digital.lantern-question-bank'),
  ('academic.materials.compiled.study-pack', 'study-materials.lantern-digital.lantern-study-pack'),
  ('academic.materials.capstone.project', 'study-materials.projects-research.project-thesis-seminar'),
  ('academic.lab.data-collection', 'study-materials.projects-research.research-data-collection'),
  ('academic.lab.equipment-rental', 'campus-essentials.lab-tools-equipment.lab-equipment-rental'),
  ('academic.lab.equipment-sale', 'campus-essentials.lab-tools-equipment.lab-instruments-sale'),
  ('campus.housing.hostel', 'housing.rooms-rentals.hostel-bedspace'),
  ('campus.housing.flat', 'housing.rooms-rentals.flat-apartment'),
  ('campus.housing.short-let', 'housing.rooms-rentals.short-let'),
  ('campus.mobility.ride', 'transport.rides-trips.intercity-trip-seat'),
  ('campus.mobility.vehicle', 'transport.vehicles-for-sale.cars'),
  ('campus.fashion.aso-ebi', 'fashion-beauty.occasion-wear.aso-ebi'),
  ('campus.fashion.everyday', 'fashion-beauty.everyday-fashion.womens-clothing'),
  ('campus.goods.other', 'campus-essentials.everything-else.other-items'),
  ('campus.services.tutoring', 'services.academic-services.tutoring-lessons'),
  ('campus.services.printing', 'services.print-design.printing-photocopy'),
  ('campus.services.other', 'services.personal-services.other-services'),
  ('campus.events.tickets', 'events-tickets.tickets.party-concert-tickets'),
  ('campus.events.social', 'events-tickets.meetups-groups.hangouts-meetups'),
  ('custom.other', 'campus-essentials.everything-else.other-items'),
  ('category:textbook_exchange', 'study-materials.textbooks.course-textbook'),
  ('category:lecture_notes', 'study-materials.notes-handouts.lecture-notes'),
  ('category:pq_bank', 'study-materials.past-questions.printed-past-questions'),
  ('category:study_pack', 'study-materials.lantern-digital.lantern-study-pack'),
  ('category:project_thesis', 'study-materials.projects-research.project-thesis-seminar'),
  ('category:data_collection', 'study-materials.projects-research.research-data-collection'),
  ('category:equipment_rental', 'campus-essentials.lab-tools-equipment.lab-equipment-rental'),
  ('category:accommodation', 'housing.rooms-rentals.hostel-bedspace'),
  ('category:travel_transport', 'transport.rides-trips.intercity-trip-seat'),
  ('category:aso_ebi', 'fashion-beauty.everyday-fashion.womens-clothing'),
  ('category:personal_goods', 'campus-essentials.everything-else.other-items'),
  ('category:campus_services', 'services.personal-services.other-services'),
  ('category:events_social', 'events-tickets.tickets.party-concert-tickets'),
  ('category:other', 'campus-essentials.everything-else.other-items'),
  ('category:custom:*', 'campus-essentials.everything-else.other-items')
) AS m(old_id, new_id)
WHERE l.category_specific_fields->>'taxonomyNodeId' = m.old_id;

-- 2. Drop every id that can no longer name a live leaf.
UPDATE marketplace_listings
SET category_specific_fields = category_specific_fields - 'taxonomyNodeId'
WHERE category_specific_fields ? 'taxonomyNodeId'
  AND category_specific_fields->>'taxonomyNodeId' <> ALL (ARRAY[
    'campus-essentials.bags-storage.backpacks-laptop-bags',
    'campus-essentials.bags-storage.boxes-trunks-storage',
    'campus-essentials.everything-else.gifts-souvenirs',
    'campus-essentials.everything-else.other-items',
    'campus-essentials.lab-tools-equipment.lab-coats-safety-gear',
    'campus-essentials.lab-tools-equipment.lab-consumables-kits',
    'campus-essentials.lab-tools-equipment.lab-equipment-rental',
    'campus-essentials.lab-tools-equipment.lab-instruments-sale',
    'campus-essentials.sports-fitness.gym-equipment',
    'campus-essentials.sports-fitness.sports-gear',
    'campus-essentials.stationery.art-craft-supplies',
    'campus-essentials.stationery.calculators-instruments',
    'campus-essentials.stationery.notebooks-pens',
    'custom.other',
    'electronics.audio-power-gadgets.cameras-gadgets',
    'electronics.audio-power-gadgets.headphones-speakers',
    'electronics.audio-power-gadgets.power-banks-inverters',
    'electronics.audio-power-gadgets.smartwatches-wearables',
    'electronics.computers.computer-accessories',
    'electronics.computers.desktops-monitors',
    'electronics.computers.laptops',
    'electronics.computers.storage-drives',
    'electronics.phones-tablets.feature-phones',
    'electronics.phones-tablets.phone-accessories',
    'electronics.phones-tablets.smartphones',
    'electronics.phones-tablets.tablets-ereaders',
    'events-tickets.event-services-rentals.decor-canopy-rentals',
    'events-tickets.event-services-rentals.event-equipment-rental',
    'events-tickets.event-services-rentals.mc-dj-hype',
    'events-tickets.meetups-groups.club-society-signups',
    'events-tickets.meetups-groups.hangouts-meetups',
    'events-tickets.tickets.dinner-award-tickets',
    'events-tickets.tickets.party-concert-tickets',
    'events-tickets.tickets.sports-game-tickets',
    'fashion-beauty.beauty-services.barbing',
    'fashion-beauty.beauty-services.hair-styling-braiding',
    'fashion-beauty.beauty-services.makeup-artist',
    'fashion-beauty.beauty-services.nails-lashes',
    'fashion-beauty.everyday-fashion.bags-jewellery',
    'fashion-beauty.everyday-fashion.mens-clothing',
    'fashion-beauty.everyday-fashion.shoes-slippers',
    'fashion-beauty.everyday-fashion.womens-clothing',
    'fashion-beauty.hair-beauty-products.perfumes-body-sprays',
    'fashion-beauty.hair-beauty-products.skincare-cosmetics',
    'fashion-beauty.hair-beauty-products.wigs-hair-extensions',
    'fashion-beauty.occasion-wear.aso-ebi',
    'fashion-beauty.occasion-wear.graduation-wear',
    'fashion-beauty.occasion-wear.native-owambe-wear',
    'fashion-beauty.occasion-wear.outfit-hire',
    'food-groceries.cooked-food.cakes-pastries',
    'food-groceries.cooked-food.drinks-smoothies',
    'food-groceries.cooked-food.home-cooked-meals',
    'food-groceries.cooked-food.snacks-small-chops',
    'food-groceries.food-services.event-catering',
    'food-groceries.food-services.meal-plan-subscription',
    'food-groceries.provisions.bulk-provisions',
    'food-groceries.provisions.raw-foodstuff',
    'housing.hostel-furnishing.beddings-curtains',
    'housing.hostel-furnishing.fans-cooling',
    'housing.hostel-furnishing.furniture-shelving',
    'housing.hostel-furnishing.kitchen-appliances',
    'housing.hostel-furnishing.mattresses-beds',
    'housing.roommates-sublets.roommate-wanted',
    'housing.roommates-sublets.sublet-takeover',
    'housing.rooms-rentals.flat-apartment',
    'housing.rooms-rentals.hostel-bedspace',
    'housing.rooms-rentals.self-contain-room',
    'housing.rooms-rentals.short-let',
    'services.academic-services.exam-prep-coaching',
    'services.academic-services.language-lessons',
    'services.academic-services.tutoring-lessons',
    'services.personal-services.errands-delivery',
    'services.personal-services.laundry-cleaning',
    'services.personal-services.other-services',
    'services.personal-services.photography-videography',
    'services.print-design.binding-lamination',
    'services.print-design.graphics-design',
    'services.print-design.printing-photocopy',
    'services.print-design.typing-transcription',
    'services.tech-repairs.device-setup-data',
    'services.tech-repairs.phone-laptop-repair',
    'services.tech-repairs.software-web-help',
    'study-materials.lantern-digital.lantern-question-bank',
    'study-materials.lantern-digital.lantern-study-pack',
    'study-materials.notes-handouts.lecture-notes',
    'study-materials.notes-handouts.summary-guides',
    'study-materials.notes-handouts.tutorial-handouts',
    'study-materials.past-questions.entrance-exam-prep',
    'study-materials.past-questions.marking-schemes',
    'study-materials.past-questions.printed-past-questions',
    'study-materials.projects-research.project-thesis-seminar',
    'study-materials.projects-research.research-data-collection',
    'study-materials.textbooks.course-textbook',
    'study-materials.textbooks.general-reading-books',
    'study-materials.textbooks.lab-manual-workbook',
    'study-materials.textbooks.solutions-manual',
    'transport.rides-trips.campus-shuttle-okada',
    'transport.rides-trips.intercity-trip-seat',
    'transport.vehicle-parts-hire.helmets-riding-gear',
    'transport.vehicle-parts-hire.spare-parts-accessories',
    'transport.vehicle-parts-hire.vehicle-hire',
    'transport.vehicles-for-sale.bicycles',
    'transport.vehicles-for-sale.cars',
    'transport.vehicles-for-sale.motorcycles-keke'
  ]);

-- 3. The browse filter reads this on every drill-down; without an index each one
--    is a sequential scan of the whole listings table.
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_taxonomy_node
  ON marketplace_listings ((category_specific_fields->>'taxonomyNodeId'))
  WHERE status = 'active';

COMMIT;

-- 104: demo copies get the template's search vectors.
-- 11 Nov 2026 audit: the demo's three sample files had no stored file and no
-- text, and once fixed Solomon still answered "nothing came back" about them,
-- because clone_demo_instance copied knowledge_files but never document_chunks.
-- Body taken from the LIVE function (pg_get_functiondef), not an older file.
-- The template's files and vectors were seeded by hand the same day.

CREATE OR REPLACE FUNCTION public.clone_demo_instance(p_user uuid, p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  src    uuid := 'de900000-0000-4000-8000-000000000001';
  srcusr uuid := 'f1eb0b1f-be17-4ade-b013-e706ea825d0e';
  new_co uuid := gen_random_uuid();
begin
  insert into companies (id, name, slug, plan_tier, plan_status, trial_ends_at, is_personal, modules_enabled, is_demo, monthly_tool_cap, monthly_spend_cap, timezone)
  select new_co, name, 'demo-'||substr(new_co::text,1,8), plan_tier, plan_status, trial_ends_at, is_personal, modules_enabled, true, monthly_tool_cap, monthly_spend_cap, timezone
    from companies where id = src;

  insert into profiles (id, company_id, role, name, email, custom_permissions)
  select p_user, new_co, 'owner', name, p_email, custom_permissions from profiles where id = srcusr;

  insert into business_profiles (company_id, business_name, industry, location, team_size, last_revenue, current_revenue, profit, hours_per_week, biggest_challenge, primary_goal, goal_timeline, vision_3yr, version_history, website, website_content, financial_settings)
  select new_co, business_name, industry, location, team_size, last_revenue, current_revenue, profit, hours_per_week, biggest_challenge, primary_goal, goal_timeline, vision_3yr, version_history, website, website_content, financial_settings
    from business_profiles where company_id = src;

  insert into terms_acceptances (user_id, company_id, version, source, accepted_at)
  select p_user, new_co, version, source, now() from terms_acceptances where company_id = src limit 1;

  -- staff
  create temp table _m_staff on commit drop as select id old_id, gen_random_uuid() new_id from staff_members where company_id = src;
  insert into staff_members (id, company_id, name, email, role, log_enabled, log_days, log_hour, phone)
  select m.new_id, new_co, s.name, s.email, s.role, s.log_enabled, s.log_days, s.log_hour, s.phone
    from staff_members s join _m_staff m on m.old_id = s.id;

  -- milestones
  create temp table _m_ms on commit drop as select id old_id, gen_random_uuid() new_id from milestones where company_id = src;
  insert into milestones (id, company_id, title, description, timeframe, category, actions, books, completed, completed_date, notes, sort_order, start_date, end_date, progress_percent, depends_on, weight, source, assignee_cid, rock_quarter, actions_done)
  select m.new_id, new_co, x.title, x.description, x.timeframe, x.category, x.actions, x.books, x.completed, x.completed_date, x.notes, x.sort_order, x.start_date, x.end_date, x.progress_percent, x.depends_on, x.weight, x.source, x.assignee_cid, x.rock_quarter, x.actions_done
    from milestones x join _m_ms m on m.old_id = x.id;

  -- templates + items
  create temp table _m_tpl on commit drop as select id old_id, gen_random_uuid() new_id from work_order_templates where company_id = src;
  insert into work_order_templates (id, company_id, name, description)
  select m.new_id, new_co, t.name, t.description from work_order_templates t join _m_tpl m on m.old_id = t.id;

  create temp table _m_tpli on commit drop as select id old_id, gen_random_uuid() new_id from work_order_template_items where template_id in (select old_id from _m_tpl);
  insert into work_order_template_items (id, template_id, position, text, notes, required)
  select mi.new_id, mt.new_id, it.position, it.text, it.notes, it.required
    from work_order_template_items it join _m_tpli mi on mi.old_id = it.id join _m_tpl mt on mt.old_id = it.template_id;

  -- work orders
  create temp table _m_wo on commit drop as select id old_id, gen_random_uuid() new_id from work_orders where company_id = src;
  insert into work_orders (id, company_id, created_by, staff_member_id, title, description, status, priority, due_date, milestone_id, created_at, template_id, assigned_staff_ids)
  select mw.new_id, new_co, p_user, ms.new_id, w.title, w.description, w.status, w.priority, w.due_date, mm.new_id, w.created_at, mt.new_id,
         coalesce((select array_agg(ms2.new_id) from _m_staff ms2 where ms2.old_id = any(coalesce(w.assigned_staff_ids, '{}'::uuid[]))), '{}'::uuid[])
    from work_orders w
    join _m_wo mw on mw.old_id = w.id
    left join _m_staff ms on ms.old_id = w.staff_member_id
    left join _m_ms mm on mm.old_id = w.milestone_id
    left join _m_tpl mt on mt.old_id = w.template_id;

  -- what each job was quoted, cost and invoiced, so the price check and the
  -- cash forecast have the copy's own numbers to work from
  insert into work_order_amounts (work_order_id, company_id, quoted_amount, cost_amount, invoiced_amount)
  select mw.new_id, new_co, a.quoted_amount, a.cost_amount, a.invoiced_amount
    from work_order_amounts a join _m_wo mw on mw.old_id = a.work_order_id
   where a.company_id = src;

  insert into daily_logs (company_id, staff_member_id, work_order_id, log_date, what_happened, blockers, hours_on_site, who_on_site, safety_note, injury, pm_note, pm_note_shared,
                          injury_detail, incident_report_filed, flha_done, on_site_staff_ids, schedule_status, percent_complete, unplanned_cost, unplanned_cost_note, metrics, reviewed_at)
  select new_co, ms.new_id, mw.new_id, d.log_date, d.what_happened, d.blockers, d.hours_on_site, d.who_on_site, d.safety_note, d.injury, d.pm_note, d.pm_note_shared,
         d.injury_detail, d.incident_report_filed, d.flha_done,
         (select array_agg(ms2.new_id) from _m_staff ms2 where ms2.old_id = any(coalesce(d.on_site_staff_ids, '{}'::uuid[]))),
         d.schedule_status, d.percent_complete, d.unplanned_cost, d.unplanned_cost_note, d.metrics, d.reviewed_at
    from daily_logs d
    left join _m_staff ms on ms.old_id = d.staff_member_id
    left join _m_wo mw on mw.old_id = d.work_order_id
    where d.company_id = src;

  insert into office_notes (company_id, note_date, note, status, work_order_id)
  select new_co, n.note_date, n.note, n.status, mw.new_id
    from office_notes n left join _m_wo mw on mw.old_id = n.work_order_id where n.company_id = src;

  insert into financial_snapshots (company_id, source, report_type, period_label, period_start, period_end, raw_json, normalized_text, synced_at)
  select new_co, source, report_type, period_label, period_start, period_end, raw_json, normalized_text, synced_at from financial_snapshots where company_id = src;

  insert into solomon_memory (company_id, kind, statement, detail, source, source_ref, status, due_on)
  select new_co, kind, statement, detail, source, source_ref, status, due_on from solomon_memory where company_id = src;

  insert into documents (company_id, user_id, tool_id, title, tags, input_data, output_data)
  select new_co, p_user, tool_id, title, tags, input_data, output_data from documents where company_id = src;

  -- Files carry their search vectors (104). Without document_chunks the copy
  -- had the files but Solomon's search_library found nothing in them.
  create temp table _m_kf on commit drop as select id old_id, gen_random_uuid() new_id from knowledge_files where company_id = src;
  insert into knowledge_files (id, company_id, title, notes, file_path, mime_type, size_bytes, kind, extracted_text, status, milestone_id)
  select m.new_id, new_co, k.title, k.notes, k.file_path, k.mime_type, k.size_bytes, k.kind, k.extracted_text, k.status, mm.new_id
    from knowledge_files k join _m_kf m on m.old_id = k.id left join _m_ms mm on mm.old_id = k.milestone_id where k.company_id = src;
  insert into document_chunks (knowledge_file_id, company_id, chunk_index, content, chunk_type, image_path, embedding, token_estimate)
  select m.new_id, new_co, c.chunk_index, c.content, c.chunk_type, c.image_path, c.embedding, c.token_estimate
    from document_chunks c join _m_kf m on m.old_id = c.knowledge_file_id where c.company_id = src;

  insert into chat_messages (company_id, user_id, chat_type, role, content, source_documents, created_at)
  select new_co, p_user, chat_type, role, content, source_documents, created_at from chat_messages where company_id = src;

  insert into checkins (company_id, user_id, revenue_update, win, challenge, mood, hours_this_week, notes)
  select new_co, p_user, revenue_update, win, challenge, mood, hours_this_week, notes from checkins where company_id = src;

  return new_co;
end;
$function$;

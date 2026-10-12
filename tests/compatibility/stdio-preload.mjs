import media from './media.json' with { type: 'json' };
// Test-only: intercept all outbound requests before the actual stdio entrypoint loads.
// Neither a real Moodle token nor a network connection is needed.
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
  const body = new URLSearchParams(String(init?.body ?? ''));
  const token = body.get('wstoken') ?? url.searchParams.get('token');
  if (url.origin !== 'https://stemlearn.sun.ac.za' || token !== 'fixture-ta') throw new Error('Fixture destination refused');
  if (init?.redirect !== 'manual') throw new Error('Fixture redirect policy refused');
  const fn = body.get('wsfunction');
  if (!fn && url.pathname.startsWith('/pluginfile.php/')) {
    const file = media.find(f => url.pathname.endsWith('/' + f.filename));
    if (file) return new Response(Buffer.from(file.base64, 'base64'), { headers: { 'content-type': file.mime } });
  }
  if (!fn && url.pathname.startsWith('/pluginfile.php/')) return new Response('fixture notes', { headers: { 'content-type': 'text/plain' } });
  const functions = ['core_webservice_get_site_info', 'core_enrol_get_users_courses', 'core_course_get_contents', 'mod_assign_get_assignments', 'mod_assign_get_submission_status', 'mod_assign_get_submissions', 'mod_assign_list_participants', 'core_group_get_activity_allowed_groups', 'core_user_get_users_by_field'];
  switch (fn) {
    case 'core_webservice_get_site_info': return Response.json({ userid: 104, sitename: 'TA', functions: functions.map(name => ({ name })) });
    case 'core_enrol_get_users_courses': return Response.json([{ id: 1, fullname: 'TA course', shortname: 'TA' }]);
    case 'core_course_get_contents': return Response.json([{ id: 1, name: 'General', modules: [{ id: 10, name: 'Notes', modname: 'resource', contents: [{ type: 'file', filename: 'notes.txt', fileurl: `${url.origin}/pluginfile.php/1/notes.txt`, filesize: 13, mimetype: 'text/plain' }, ...media.map(f => ({ type: 'file', filename: f.filename, fileurl: `${url.origin}/pluginfile.php/1/${f.filename}`, filesize: Buffer.from(f.base64, 'base64').length, mimetype: f.mime }))] }] }]);
    default: throw new Error('Fixture function unavailable');
  }
};

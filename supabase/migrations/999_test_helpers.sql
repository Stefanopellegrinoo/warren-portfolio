CREATE OR REPLACE FUNCTION set_auth_uid_for_test(uid UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
END;
$$ LANGUAGE plpgsql;

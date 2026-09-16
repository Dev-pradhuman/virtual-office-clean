const CAN_TURN_OFF_V_OFFICE = 'can_turn_off_v_office';
const SUPPORTED_PERMISSIONS = new Set([CAN_TURN_OFF_V_OFFICE]);

function hasPermission(db, userId, key, callback) {
  if (!SUPPORTED_PERMISSIONS.has(key)) return callback(null, false);
  db.get(
    'SELECT 1 AS granted FROM user_permissions WHERE user_id = ? AND permission_key = ?',
    [userId, key],
    (err, row) => callback(err, !!row)
  );
}

module.exports = { CAN_TURN_OFF_V_OFFICE, SUPPORTED_PERMISSIONS, hasPermission };

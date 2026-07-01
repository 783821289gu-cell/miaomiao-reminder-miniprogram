# Cloud function triggers

The project needs exactly two timer triggers:

| Function | Trigger | Schedule | Purpose |
| --- | --- | --- | --- |
| `sendReminders` | `sendRemindersEveryMinute` | `0 * * * * * *` | Send due reminder jobs every minute |
| `cleanupData` | `cleanupDataDaily` | `0 15 3 * * * *` | Clean AI logs and trim impossible reminder jobs every day at 03:15 |

All other cloud functions are called on demand and must not have timer triggers.

Recommended `aiLogs` indexes:

- `createdAt` ascending, for retention and global-limit cleanup.
- `_openid` ascending + `createdAt` ascending, for per-user cleanup.

Recommended `reminderJobs` indexes:

- `status` ascending + `remindAtTs` ascending, for due reminder delivery.
- `status` ascending + `updatedAt` ascending, for dirty-job cleanup.

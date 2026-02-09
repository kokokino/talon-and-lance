import { Migrations } from 'meteor/quave:migrations';

// Import migration steps
import './1_create_used_nonces_ttl_index.js';

// Run migrations on startup
Migrations.migrateTo('latest');

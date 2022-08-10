import { Sequelize } from 'sequelize';

import Message from './message.model.js';
import Thread from './thread.model.js';
import User from './user.model.js';

User.hasMany( Message );
Message.belongsTo( User );

Thread.hasMany( Message );
Message.belongsTo( Thread );

console.log( Sequelize );

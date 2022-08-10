'use strict';

import { Sequelize, DataTypes } from 'sequelize';

const sequelize = new Sequelize('sqlite::memory:');

const Message = sequelize.define( 

    'Message', 

    {
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },

        text: {
            type: DataTypes.STRING,
            allowNull: false
        }
    }
);

export default Message;

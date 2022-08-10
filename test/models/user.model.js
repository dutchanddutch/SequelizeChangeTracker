'use strict';

import { Sequelize, DataTypes } from 'sequelize';

const sequelize = new Sequelize('sqlite::memory:');

const User = sequelize.define( 

    'User', 

    {
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },

        email: {
            type: DataTypes.STRING,
            allowNull: false
        }
    }
);

export default User;

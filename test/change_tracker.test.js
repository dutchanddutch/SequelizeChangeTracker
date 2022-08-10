'use strict'

import { expect } from 'chai';
import { Sequelize, DataTypes, BelongsToMany } from 'sequelize';
import SequelizeChangeTracker from '../index.js';
import { pause } from './lib.js';

const sequelize = new Sequelize('sqlite::memory:', { logging: false });

const stdFields = { 
    id: { primaryKey: true, type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4 }, 
    value: { type: DataTypes.STRING }
};

const createModels = () => {

    const A = sequelize.define('A', stdFields );
    const B = sequelize.define('B', stdFields );
    const AHasOne = sequelize.define('AHasOne', stdFields );
    const AHasManyBelongsTo = sequelize.define('AHasManyBelongsTo', stdFields );
    const AHasManySingle = sequelize.define('AHasManySingle', stdFields );
    const BelongsToASingle = sequelize.define('BelongsToASingle', stdFields );
    const BelongsToManyARecip = sequelize.define('BelongsToManyARecip', stdFields );
    const BelongsToManyASingle = sequelize.define('BelongsToManyASingle', stdFields );

    A.hasOne( AHasOne );

    A.hasMany( AHasManyBelongsTo );
    AHasManyBelongsTo.belongsTo( A );

    A.hasMany( AHasManySingle );

    BelongsToASingle.belongsTo( A );

    A.belongsToMany( BelongsToManyARecip, { through: 'AB' } );
    BelongsToManyARecip.belongsToMany( A, { through: 'AB' } );

    BelongsToManyASingle.belongsToMany( A, { through: 'ABs' } );


    return { A, B, AHasOne, AHasManyBelongsTo, AHasManySingle, BelongsToManyARecip, BelongsToASingle, BelongsToManyARecip, BelongsToManyASingle };
}

describe( 'Change Tracker', function() {

    let models = null;
    let ct = null;
    let changeRegister = null;


    beforeEach( async function() {

        models = createModels();
        const modelArr = Object.values( models );
        await sequelize.sync({ force: true });

        changeRegister = [];
        ct = new SequelizeChangeTracker({ models: modelArr });
        ct.on('data-changed', function( event ) {
            changeRegister.push( event );
        });

    });

    afterEach( async function() {
        ct.destroy();
        ct = null;
    });

    it ( 'Should create a map of depending models', function() {

        // A depends on all models except B
        // BelongToManyRecip depends on A

        for ( let modelName of Object.keys( ct.dependingModelMap ) ) {
            expect( ct.dependingModelMap[ modelName ] ).to.be.an('array');
            switch ( modelName ) {
                case 'A':
                    expect( ct.dependingModelMap.A[0] ).to.equal( 'BelongsToManyARecip' );
                    break;
                case 'B':
                    expect( ct.dependingModelMap.B ).to.have.length( 0 );
                    break;
                default:
                    expect( ct.dependingModelMap[ modelName ][0] ).to.equal( 'A' );
                    break;
            }
        }
    });

    it ( 'Should register specific subscriptions on read with "trackChanges" option', async function() {
        const b = await models.B.create();
        await models.B.findOne({ 
            where: { id: b.id }, 
            trackChanges: { subscriptionId: 1 } 
        });
        expect( ct.subscriptionsByResource.B ).to.be.an( 'object' );
        expect( ct.subscriptionsByResource.B[ b.id ] ).to.be.an( 'array' );
        expect( ct.subscriptionsByResource.B[ b.id ][ 0 ] ).to.equal( 1 );
    });


    it ( 'Should register subscriptions on create with "trackChanges" option', async function() {
        const b = await models.B.create({}, { trackChanges: { subscriptionId: 1 }});
        expect( ct.subscriptionsByResource.B ).to.be.an( 'object' );
        expect( ct.subscriptionsByResource.B[ b.id ] ).to.be.an( 'array' );
        expect( ct.subscriptionsByResource.B[ b.id ][ 0 ] ).to.equal( 1 );
    });


    it ( 'Should register generic subscriptions', async function() {
        ct.addSubscription({ modelName: 'B', subscriptionId: 1 });
        expect( ct.subscriptionsByResource.B ).to.be.an( 'object' );
        expect( ct.subscriptionsByResource.B.generic ).to.be.an( 'array' );
        //console.log( ct.subscriptionsByResource )
        expect( ct.subscriptionsByResource.B.generic[ 0 ] ).to.equal( 1 );
    });

    describe( 'On update', function() {
        it ( 'Should send direct specific change events', async function() {

            const b = await models.B.create();
            await models.B.findOne({ 
                where: { id: b.id }, 
                trackChanges: { subscriptionId: 1 } 
            });

            const randomValue = '' + Math.random();
            await b.update({
                value: randomValue
            });

            //console.log( 'cr', changeRegister )

            expect( changeRegister[ 0 ] ).not.to.be.a( 'undefined' );
            expect( changeRegister[ 0 ].model ).to.equal( 'B' );
            expect( changeRegister[ 0 ].subscriptionIds ).to.be.an( 'array' );
            expect( changeRegister[ 0 ].subscriptionIds[ 0 ] ).to.equal( 1 );
            expect( changeRegister[ 0 ].instance.value ).to.equal( randomValue );
            expect( changeRegister[ 0 ].changedFields ).to.be.an( 'array' );
        });

        it( 'Should send depending 1:many specific change events', async function() {

            const a = await models.A.create({}, { trackChanges: { subscriptionId: 1 }});

            const aHasOne = await models.AHasOne.create(
                { AId: a.id },
                { trackChanges: { subscriptionId: 2 }}
            );

            //console.log( aHasOne );

            const randomValue = '' + Math.random();
            await aHasOne.update({
                value: randomValue
            });

            //console.log( 'cr', changeRegister );

            expect( changeRegister[ 0 ] ).not.to.be.a( 'undefined' );
            expect( changeRegister[ 0 ].subscriptionIds ).to.be.an( 'array' );
            expect( changeRegister[ 0 ].subscriptionIds[ 0 ] ).to.equal( 1 );

            expect( changeRegister[ 1 ] ).not.to.be.a( 'undefined' );
            expect( changeRegister[ 1 ].model ).to.equal( 'AHasOne' );
            expect( changeRegister[ 1 ].subscriptionIds ).to.be.an( 'array' );
            expect( changeRegister[ 1 ].subscriptionIds[ 0 ] ).to.equal( 2 );
            expect( changeRegister[ 1 ].subscriptionIds[ 1 ] ).to.equal( 1 );
            expect( changeRegister[ 1 ].instance.value ).to.equal( randomValue );
            expect( changeRegister[ 1 ].changedFields ).to.be.an( 'array' );

        });
    });

    describe( 'On create', function() {

        it( 'Should send generic create events to direct subscribers', async function() {

            ct.addSubscription({ modelName: 'B', subscriptionId: 1 });
            await models.B.create();

            //console.log( 'cr', changeRegister );

            expect( changeRegister[ 0 ] ).not.to.be.a( 'undefined' );
            expect( changeRegister[ 0 ].subscriptionIds ).to.be.an( 'array' );
            expect( changeRegister[ 0 ].subscriptionIds[ 0 ] ).to.equal( 1 );
            expect( changeRegister[ 0 ].operation ).to.equal( 'create' );
            expect( changeRegister[ 0 ].model ).to.equal( 'B' );

        });


        it( 'Should send generic create events to depending subscribers', async function() {

            const a = await models.A.create();

            ct.addSubscription({ modelName: 'A', subscriptionId: 1, instanceId: a.id });
            
            const aHasOne = await models.AHasOne.create(
                { AId: a.id },
            );

            //console.log( 'cr', changeRegister );

            expect( changeRegister[ 0 ] ).not.to.be.a( 'undefined' );
            expect( changeRegister[ 0 ].subscriptionIds ).to.be.an( 'array' );
            expect( changeRegister[ 0 ].subscriptionIds[ 0 ] ).to.equal( 1 );
            expect( changeRegister[ 0 ].operation ).to.equal( 'create' );
            expect( changeRegister[ 0 ].model ).to.equal( 'AHasOne' );
        });
    });


    describe( 'On delete', function() {

        it( 'Should send generic delete events', async function() {

            const b = await models.B.create();

            ct.addSubscription({ modelName: 'B', subscriptionId: 1 });

            await b.destroy();

            //console.log( 'cr', changeRegister );

            expect( changeRegister[ 0 ] ).not.to.be.a( 'undefined' );
            expect( changeRegister[ 0 ].subscriptionIds ).to.be.an( 'array' );
            expect( changeRegister[ 0 ].subscriptionIds[ 0 ] ).to.equal( 1 );
            expect( changeRegister[ 0 ].operation ).to.equal( 'delete' );
            expect( changeRegister[ 0 ].model ).to.equal( 'B' );


        });

        it( 'Should send depending events', async function() {

            const a = await models.A.create();

            const aHasOne = await models.AHasOne.create(
                { AId: a.id },
            );

            ct.addSubscription({ modelName: 'A', subscriptionId: 1, instanceId: a.id });

            await aHasOne.destroy();

            //console.log( 'cr', changeRegister );

            expect( changeRegister[ 0 ] ).not.to.be.a( 'undefined' );
            expect( changeRegister[ 0 ].subscriptionIds ).to.be.an( 'array' );
            expect( changeRegister[ 0 ].subscriptionIds[ 0 ] ).to.equal( 1 );
            expect( changeRegister[ 0 ].operation ).to.equal( 'delete' );
            expect( changeRegister[ 0 ].model ).to.equal( 'AHasOne' );

        });
    });
});

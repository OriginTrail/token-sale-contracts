import increaseTime from '../node_modules/zeppelin-solidity/test/helpers/increaseTime';
import expectThrow from '../node_modules/zeppelin-solidity/test/helpers/expectThrow';
const BigNumber = web3.BigNumber;
require('chai')
.use(require('chai-as-promised'))
.use(require('chai-bignumber')(web3.BigNumber))
.should();
var TraceToken = artifacts.require("./TraceToken.sol");
var TokenSale = artifacts.require("./TraceTokenSale.sol");

const REVERT_MSG = 'VM Exception while processing transaction: revert';
const ETHER = new web3.BigNumber(10).toPower(18) ;

contract('TokenSale', (accounts) => {
    let owner, wallet, client, client2, token, tokensale, startTime, endTime,foundersWallet,advisorsWallet, teamAndFounders,preicoAndAdvisors ;
    let totalTokenSupply, testMaxEther, testRate, minEthInvestment, maxEthInvestment, presaleLimit, softCap, hardCap;
    let Token = TraceToken;
    let weekInSeconds = 86400 * 7;

    before(async () => {
        owner = web3.eth.accounts[0];
        wallet = web3.eth.accounts[1];
        client = web3.eth.accounts[2];
        client2 = web3.eth.accounts[3];
        foundersWallet = web3.eth.accounts[4];
        advisorsWallet = web3.eth.accounts[5];
    });

    let shouldHaveException = async (fn, error_msg) => {
        let has_error = false;

        try {
            await fn();
        } catch(err) {
            has_error = true;
        } finally {
            assert.equal(has_error, true, error_msg);
        }        

    }

    let balanceEqualTo = async (client, should_balance) => {
        let balance;

        balance = await token.balanceOf(client, {from: client});
        assert.equal(balance.toNumber(), should_balance, `Token balance should be equal to ${should_balance}`);
    };



    beforeEach(async function () {
        startTime = web3.eth.getBlock('latest').timestamp + weekInSeconds;
        tokensale = await TokenSale.new(startTime, wallet, foundersWallet, advisorsWallet);
        token = await Token.at(await tokensale.token());
        totalTokenSupply = await tokensale.TOTAL_NUM_TOKENS();
        testRate = await tokensale.token_per_wei();
        softCap = await tokensale.softCap();
        hardCap = await tokensale.hardCap();
        minEthInvestment = await tokensale.min_investment_eth();
        maxEthInvestment = await tokensale.max_investment_eth();
        presaleLimit = await tokensale.presaleLimit();
        teamAndFounders = await tokensale.teamAndFounders();
        preicoAndAdvisors = await tokensale.preicoAndAdvisors();
        testMaxEther = totalTokenSupply / testRate;
    });


    describe('#beforeSale', async ()=>{

        it("owner should be owner", async () => {
            owner.should.be.equal( await tokensale.owner());
        });

        it("client shouldn't be owner", async () => {
            client.should.not.be.equal( await tokensale.owner());
            
        });

        it("Balance of client should be 0", async () => {
            assert.equal(await tokensale.balanceOf(client), 0, "Must be 0 on the start");
        });

        it("Total token supply should be 0", async () => {
            assert.equal(await token.totalSupply(), 0, "Must be 0 on the start");
        });

        it('can not buy if not initialized', async () => {
            await tokensale.sendTransaction({amount: ETHER})
            .should.be.rejectedWith(REVERT_MSG);
        });
        it("cannot donate before startTime", async () => {
            await tokensale.addWhitelist(client, 10 * ETHER, {from: owner});
            var buyTx = await tokensale.buyTokens(client, { from: client, value: 1e19 })
            .should.be.rejectedWith(REVERT_MSG);

        });

    });  

    describe('#whitelist checks', async ()=>{

        it('addWhitelist cannot by called by non-owner', async ()=> {
            await tokensale.addWhitelist(owner, 10 * ETHER, {from: client})
            .should.be.rejectedWith(REVERT_MSG);
        });


        it('addWhitelist should add client if called by owner', async ()=> {
            await tokensale.addWhitelist(client, 10 * ETHER, {from: owner});

            var check = await tokensale.checkWhitelist(client,10*ETHER);

            check.should.be.equal(true);
        });

        it('cannot buy if not whitelisted', async () => {
            await tokensale.sendTransaction({amount: ETHER})
            .should.be.rejectedWith(REVERT_MSG);
        });

    });  


    describe('Ongoing sale', async ()=>{

        it("should start tokensale after startTime", async() => {
            assert.equal((await tokensale.hasStarted()), false);
            await increaseTime(weekInSeconds);
            assert.equal((await tokensale.hasStarted()), true);
        });


        it("should forbid token transfer", async() => {
            let has_error = false;
            await increaseTime(weekInSeconds);
            await token.transfer(client,10)
            .should.be.rejectedWith(REVERT_MSG);

        });


        it("should forbid token transfer via transferFrom", async() => {
            let has_error = false;
            await increaseTime(weekInSeconds);
            await token.transferFrom(client, owner,10)
            .should.be.rejectedWith(REVERT_MSG);
            
        });


        it("should not sell less than token", async() => {
            await increaseTime(weekInSeconds);
            
            await tokensale.buyTokens(client,{ value: 0.5 * ETHER })
            .should.be.rejectedWith(REVERT_MSG);
        });


        it("should have token balance equal zero for client", async() => {
            let balance;
            await increaseTime(2*weekInSeconds);
            balance = await token.balanceOf(client);
            assert.equal(balance, 0, "Token balance should be 0");

        });

        it("should reject buying less than min_investment", async() =>{
            let veryLowBuyIn = 0.5 * minEthInvestment;
            await tokensale.addWhitelist(client, veryLowBuyIn, {from: owner});

            await increaseTime(2*weekInSeconds);
            await tokensale.buyTokens(client, { value: veryLowBuyIn })
            .should.be.rejectedWith(REVERT_MSG);
            

        });

        it("should reject buying more than max_investment", async() =>{
            let veryHighBuyIn = 2* maxEthInvestment;

            await tokensale.addWhitelist(client, veryHighBuyIn, {from: owner});
            await increaseTime(2*weekInSeconds);
            await tokensale.buyTokens(client, { value: veryHighBuyIn })
            .should.be.rejectedWith(REVERT_MSG);

        });

        it("should accept buying between min and max in week 1 and check if 20% discount", async() =>{
            let ethBuyIn = 6 * ETHER;
            let tokenAmountToBuy = Math.floor(ethBuyIn * Math.floor(testRate*100/80));

            await tokensale.addWhitelist(client, ethBuyIn, {from: owner});
            await increaseTime(weekInSeconds+5000);
            var check = await tokensale.checkWhitelist(client,ethBuyIn);

            check.should.be.equal(true);

            var hasStarted = await tokensale.hasStarted();
            hasStarted.should.be.equal(true);

            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });
            var balance = await tokensale.balanceOf(client);
            assert.equal(balance.toNumber(), tokenAmountToBuy, "Token balance should be "+tokenAmountToBuy);
        });


        it("should reject buying between less than minimum investment in presale", async() =>{
            let ethBuyIn = 3 * ETHER;
            
            await tokensale.addWhitelist(client, ethBuyIn, {from: owner});
            await increaseTime(weekInSeconds+5000);
            var check = await tokensale.checkWhitelist(client,ethBuyIn);

            check.should.be.equal(true);

            var hasStarted = await tokensale.hasStarted();
            hasStarted.should.be.equal(true);

            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn }).should.be.rejectedWith(REVERT_MSG);
        });



        it("should accept buying between min and max in week 2 and check if 15% discount", async() =>{
            let ethBuyIn = 6 * ETHER;
            let tokenAmountToBuy = Math.floor(ethBuyIn * Math.floor(testRate*100/85));

            await tokensale.addWhitelist(client, ethBuyIn, {from: owner});
            await increaseTime(2*weekInSeconds + 5000);
            var check = await tokensale.checkWhitelist(client,ethBuyIn);

            check.should.be.equal(true);

            var hasStarted = await tokensale.hasStarted();
            hasStarted.should.be.equal(true);

            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });
            var balance = await tokensale.balanceOf(client);
            assert.equal(balance.toNumber(), tokenAmountToBuy, "Token balance should be "+tokenAmountToBuy);
            
        });


        it("should have no discount in week 3", async() =>{
            let ethBuyIn = 2 * ETHER;
            let tokenAmountToBuy = Math.floor(ethBuyIn * testRate);

            await tokensale.addWhitelist(client, ethBuyIn, {from: owner});
            await increaseTime(3*weekInSeconds + 5000);
            var check = await tokensale.checkWhitelist(client,ethBuyIn);

            check.should.be.equal(true);

            var hasStarted = await tokensale.hasStarted();
            hasStarted.should.be.equal(true);

            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });
            var balance = await tokensale.balanceOf(client);
            assert.equal(balance.toNumber(), tokenAmountToBuy, "Token balance should be "+tokenAmountToBuy);
            
        });

        it("should check if whitelisted amount is corrected accordingly after token buying", async() =>{
            let ethBuyInMax = 1000 * ETHER;
            let ethBuyIn = 100 * ETHER;
            let tokenAmountToBuy = Math.floor(ethBuyIn * testRate);

            await tokensale.addWhitelist(client, ethBuyInMax, {from: owner}); // whitelist for 1000 ETH
            await increaseTime(3*weekInSeconds + 5000); // presale ended
            var check = await tokensale.checkWhitelist(client,ethBuyIn);

            check.should.be.equal(true);

            var hasStarted = await tokensale.hasStarted();
            hasStarted.should.be.equal(true);

            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });
            var balance = await tokensale.balanceOf(client);
            assert.equal(balance.toNumber(), tokenAmountToBuy, "Token balance should be "+tokenAmountToBuy);

            var checkAgainForHighAmount = await tokensale.checkWhitelist(client,ethBuyInMax);
            checkAgainForHighAmount.should.be.equal(false);

            var checkAgainForLowAmount = await tokensale.checkWhitelist(client,ethBuyIn);
            checkAgainForLowAmount.should.be.equal(true);
        });

        it("should have no discount if presaleLimit reached", async() =>{
            let ethBuyIn = maxEthInvestment;
            let tokenAmountToBuy = Math.floor(ethBuyIn * testRate); // no discount

            await tokensale.addWhitelist(client, presaleLimit * 2, {from: owner});
            var check = await tokensale.checkWhitelist(client,presaleLimit * 2);
            check.should.be.equal(true);

            await tokensale.addWhitelist(client2, ethBuyIn, {from: owner});
            var check2 = await tokensale.checkWhitelist(client2,ethBuyIn);
            check2.should.be.equal(true);

            await increaseTime(1*weekInSeconds + 5000);
            var hasStarted = await tokensale.hasStarted();
            hasStarted.should.be.equal(true);

            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });

            var buyAfterPresale = await tokensale.buyTokens(client2, { from: client2, value: ethBuyIn });    

            var balance = await tokensale.balanceOf(client2);
            assert.equal(balance.toNumber(), tokenAmountToBuy, "Token balance should be "+tokenAmountToBuy);
            
        });


        it('forbid finalizing crowdsale if endTime not reached', async () => {
            await increaseTime(3*weekInSeconds);
            await tokensale.finishCrowdsale({from: client})
            .should.be.rejectedWith(REVERT_MSG);
        });


        it("should throw when hardCap gets overrun", async() =>{
            let ethBuyIn = maxEthInvestment*0.9;
            let tokenAmountToBuy = Math.floor(ethBuyIn * testRate); // no discount

            await tokensale.addWhitelist(client, hardCap, {from: owner});
            var check = await tokensale.checkWhitelist(client,presaleLimit * 2);
            check.should.be.equal(true);

            await tokensale.addWhitelist(client2, ethBuyIn, {from: owner});
            var check2 = await tokensale.checkWhitelist(client2,ethBuyIn);
            check2.should.be.equal(true);

            await increaseTime(1*weekInSeconds + 5000);
            var hasStarted = await tokensale.hasStarted();
            hasStarted.should.be.equal(true);

            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });
            var buyTx2 = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });


            shouldHaveException(async ()=>{
                var buyTx3 = await tokensale.buyTokens(client, { from: client, value: ethBuyIn });
            });


        });

        it("should NOT allow withdraw when !softCapReached", async() =>{

                // reach the soft cap
                await tokensale.addWhitelist(client, hardCap, {from: owner});
                var check = await tokensale.checkWhitelist(client,presaleLimit * 2);
                check.should.be.equal(true);
                await increaseTime(4*weekInSeconds);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: 2*ETHER });  
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(false);

                var prevBalance = (await web3.eth.getBalance(wallet)).toNumber();
                var contractBalance = (await web3.eth.getBalance(tokensale.address)).toNumber();

                await shouldHaveException(async () => {
                 var withdraw = await tokensale.withdraw({ from: owner});
             }, "Should throw if !softCapReached");
                
            });


        it("should allow withdraw when softCapReached", async() =>{

                // reach the soft cap
                await tokensale.addWhitelist(client, hardCap, {from: owner});
                var check = await tokensale.checkWhitelist(client,presaleLimit * 2);
                check.should.be.equal(true);
                await increaseTime(4*weekInSeconds);
                var numberOfBuys = Math.ceil(softCap.c / maxEthInvestment.c);
                var buyTx =[];
                let foundersRewardAfter3months = Math.floor(teamAndFounders/8);
                for (var i=0;i<= numberOfBuys; i++){
                    buyTx[i] = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  

                    if (i== numberOfBuys){

                        var softCapReached = await tokensale.softCapReached();
                        softCapReached.should.be.equal(true);

                        var prevBalance = (await web3.eth.getBalance(wallet)).toNumber();
                        var contractBalance = (await web3.eth.getBalance(tokensale.address)).toNumber();

                        var withdraw = await tokensale.withdraw({ from: owner});
                        var newBalance = (await web3.eth.getBalance(wallet)).toNumber();
                    }
                } 
                
            });


        it("should let owner pause the sale", async() =>{
            await increaseTime(2*weekInSeconds);
            var paused = await tokensale.isPaused( { from: owner });
            paused.should.be.equal(false);

            await tokensale.pauseSale({from: owner}); // paused
            paused = await tokensale.isPaused( { from: owner });
            paused.should.be.equal(true);
        });


        it("should let owner unpause the sale", async() =>{
            await increaseTime(2*weekInSeconds);
            var paused;
            await tokensale.pauseSale({from: owner}); // paused
            paused = await tokensale.isPaused( { from: owner });
            paused.should.be.equal(true);
            await increaseTime(weekInSeconds);
            await tokensale.unpauseSale({from: owner}); // paused
            paused = await tokensale.isPaused( { from: owner });
            paused.should.be.equal(false);

        });

        it("should NOT let client pause the sale", async() =>{
            var paused = await tokensale.isPaused( { from: owner });
            paused.should.be.equal(false);
            await tokensale.pauseSale({from: client})
            .should.be.rejectedWith(REVERT_MSG);
        });


        it("should reject buying if sale is paused", async() =>{
            let ethBuyIn = 2 * ETHER;

            await tokensale.addWhitelist(client, ethBuyIn, {from: owner});
            await increaseTime(2*weekInSeconds);

            await tokensale.pauseSale({from: owner}); // paused
            var paused = await tokensale.isPaused( { from: owner });
            paused.should.be.equal(true);
            var buyTx = await tokensale.buyTokens(client, { from: client, value: ethBuyIn })
            .should.be.rejectedWith(REVERT_MSG);
        });
    });



describe('#after sale tests - ', async ()=>{

    it('allow finalizing crowdsale if endTime reached', async () => {
        await increaseTime(7*weekInSeconds);
        await tokensale.finishCrowdsale({from: owner});
        assert.equal(await tokensale.hasEnded(), true);
    });

    it("should NOT allow finalizing the crowdsale before endTime", async() => {
        await increaseTime(2*weekInSeconds);

        await tokensale.addWhitelist(client, 10 * ETHER, {from: owner});
        var check = await tokensale.checkWhitelist(client,10*ETHER);
        check.should.be.equal(true);

        var buyTx = await tokensale.buyTokens(client, { from: client, value: 10 * ETHER });  

        await increaseTime(2*weekInSeconds);
        await shouldHaveException(async () => {
            await tokensale.finishCrowdsale({from: owner});    
        },'Not allowing finishCrowdsale');
        
    });

    it("cannot donate after endTime", async () => {
        await increaseTime(7*weekInSeconds+5000);
        await tokensale.addWhitelist(client, 10 * ETHER, {from: owner})
        .should.be.rejectedWith(REVERT_MSG);
        var buyTx = await tokensale.buyTokens(client, { from: client, value: 1e19 })
        .should.be.rejectedWith(REVERT_MSG);
    });




    it("should refund eth to backers if softCap not reached after sale", async() => {
        await increaseTime(2*weekInSeconds);

        await tokensale.addWhitelist(client, 10 * ETHER, {from: owner});
        var check = await tokensale.checkWhitelist(client,10*ETHER);
        check.should.be.equal(true);

        var buyTx = await tokensale.buyTokens(client, { from: client, value: 10 * ETHER });  

        await increaseTime(6*weekInSeconds);

        var hasEnded = await tokensale.hasEnded();
        hasEnded.should.be.equal(true);

        var softCapReached = await tokensale.softCapReached();
        softCapReached.should.be.equal(false);

        await tokensale.finishCrowdsale({ from: owner });
        await increaseTime(weekInSeconds);
        // var refundTx = await tokensale.refund({from: client});
        // assert.equal(refundTx,true);
    });

    it("should NOT refund eth to backers if softCap reached after sale", async() => {
        await increaseTime(2*weekInSeconds);

        await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
        var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
        check.should.be.equal(true);

        var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment});  
        var buyTx2 = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment});  

        var softCapReached = await tokensale.softCapReached();
        softCapReached.should.be.equal(true);

        await increaseTime(12*weekInSeconds);

        var hasEnded = await tokensale.hasEnded();
        hasEnded.should.be.equal(true);

        await tokensale.finishCrowdsale({ from: owner });

        await increaseTime(weekInSeconds);
        await shouldHaveException(async () => {
            await tokensale.refund({from: client});
        });

        
    });



    it("should transfer proper founderReward after 3 months ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let foundersRewardAfter3months = Math.floor(teamAndFounders/8);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(15*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), foundersRewardAfter3months, "Token balance should be "+foundersRewardAfter3months);


            });


    it("should transfer proper founderReward after 6 months ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter6m = Math.floor(teamAndFounders/4);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(28*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), rewardAfter6m, "Token balance should be "+rewardAfter6m);


            });

    it("should transfer proper founderReward after 9 months ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter9m = Math.floor(3*teamAndFounders/8);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(41*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), rewardAfter9m, "Token balance should be "+rewardAfter9m);


            });

    it("should transfer proper founderReward after 12 months ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter12m = Math.floor(teamAndFounders/2);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(54*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), rewardAfter12m, "Token balance should be "+rewardAfter12m);


            });

    it("should transfer proper founderReward after 15 months ", async() =>{

        await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
        var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
        check.should.be.equal(true);

        await increaseTime(4*weekInSeconds);
        let rewardAfter15m = Math.floor(5*teamAndFounders/8);

        var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
        var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

        await increaseTime(67*weekInSeconds);

        var hasEnded = await tokensale.hasEnded();
        hasEnded.should.be.equal(true);

        var softCapReached = await tokensale.softCapReached();
        softCapReached.should.be.equal(true);

        var finish = await tokensale.finishCrowdsale({ from: owner });
        var reward = await tokensale.withdrawTokenToFounders({ from: owner});
        var balance = await tokensale.balanceOf(foundersWallet);

        assert.equal(balance.toNumber(), rewardAfter15m, "Token balance should be "+rewardAfter15m);


    });


    it("should transfer proper founderReward after 18 months ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter18m = Math.floor(6*teamAndFounders/8);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(80*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), rewardAfter18m, "Token balance should be "+rewardAfter18m);


            });

    it("should transfer proper founderReward after 21 months ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter18m = Math.floor(7*teamAndFounders/8);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(93*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), rewardAfter18m, "Token balance should be "+rewardAfter18m);


            });

    it("should transfer proper founderReward after 24 months ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter24m = Math.floor(teamAndFounders);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(106*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), rewardAfter24m, "Token balance should be "+rewardAfter24m);


            });


    it("should transfer not allow more than founderReward ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter24m = Math.floor(teamAndFounders);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(106*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokenToFounders({ from: owner});
                // try another time
                var reward1 = await tokensale.withdrawTokenToFounders({ from: owner});
                var balance = await tokensale.balanceOf(foundersWallet);

                assert.equal(balance.toNumber(), rewardAfter24m, "Token balance should be "+rewardAfter24m);


            });



    it("should transfer proper advisorReward after 90 days ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                // let preicoAndAdvisors = await tokensale.preicoAndAdvisorsAmounts();


                let rewardAfter3m = Math.floor(preicoAndAdvisors*3/5);
                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(15*weekInSeconds);
                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokensToAdvisors({ from: owner});
                var balance = await tokensale.balanceOf(advisorsWallet);

                assert.equal(balance.toNumber(), rewardAfter3m, "Token balance should be "+rewardAfter3m);


            });

    it("should transfer proper advisorReward after 180 days ", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter6m = Math.floor(preicoAndAdvisors);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(30*weekInSeconds);
                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var reward = await tokensale.withdrawTokensToAdvisors({ from: owner});
                var balance = await tokensale.balanceOf(advisorsWallet);

                assert.equal(balance.toNumber(), rewardAfter6m, "Token balance should be "+rewardAfter6m);


            });

    it("final token balance should be 500M", async() =>{
                // reach the soft cap
                await tokensale.addWhitelist(client, 2*maxEthInvestment, {from: owner});
                var check = await tokensale.checkWhitelist(client,2*maxEthInvestment);
                check.should.be.equal(true);

                await increaseTime(4*weekInSeconds);
                let rewardAfter24m = Math.floor(teamAndFounders);

                var buyTx = await tokensale.buyTokens(client, { from: client, value: maxEthInvestment });  
                var buyTx2 = await tokensale.buyTokens(client, { from: client, value: 10*ETHER });  

                await increaseTime(106*weekInSeconds);

                var hasEnded = await tokensale.hasEnded();
                hasEnded.should.be.equal(true);
                
                var softCapReached = await tokensale.softCapReached();
                softCapReached.should.be.equal(true);

                var finish = await tokensale.finishCrowdsale({ from: owner });
                var totalSupply = await token.totalSupply();


                assert.equal(Number(totalSupply.c), Number(totalTokenSupply.c), "Token balance should be "+totalTokenSupply.c);

            });

}); 
describe('#token contract tests', async ()=>{



    it('should forbid minting from client', async ()=>{


        await shouldHaveException(async () => {
           await Token.mint(client,100, {from: client})
       });

    });

    it('should forbid endMinting from client', async ()=>{


        await shouldHaveException(async () => {
           await Token.endMinting(true, {from: client})
       });
        
    });
});



});
